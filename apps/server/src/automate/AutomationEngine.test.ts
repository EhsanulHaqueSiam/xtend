import { describe, expect, it } from "@effect/vitest";
import { type RuleInput, XApiError, type XPost } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Events from "../events/Events.ts";
import * as PeopleStore from "../leads/PeopleStore.ts";
import * as XExtra from "../leads/XExtra.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as AutomationEngine from "./AutomationEngine.ts";
import * as RuleStore from "./RuleStore.ts";

const HOUR = 3_600_000;
const ago = (ms: number) =>
  DateTime.formatIso(DateTime.subtractDuration(DateTime.nowUnsafe(), Duration.millis(ms)));
const post = (postId: string, ageMs: number, views: number, hasLink = false): XPost => ({
  postId,
  url: `https://x.com/siam/status/${postId}`,
  text: "t",
  createdAt: ago(ageMs),
  lang: null,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink,
  author: {
    userId: "1",
    handle: "siam",
    name: "Siam",
    followers: 10,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

// Own timeline: one post from six days ago, one from 2 hours ago, one from 30 hours ago; all over threshold.
const timeline = [
  post("old", 6 * 24 * HOUR, 5000),
  post("fresh", 2 * HOUR, 5000),
  post("day", 30 * HOUR, 5000, true),
];
const liked: Array<string> = [];
const unliked: Array<string> = [];
const deleted: Array<string> = [];
let failLikes = false;

const down = new XApiError({ endpoint: "x", reason: "provider", status: 500, detail: "down" });

const xExtraStub = Layer.succeed(XExtra.XExtra)({
  engagers: () => Effect.succeed({ matches: [], costUsd: 0 }),
  unrepost: () => Effect.void,
  unlike: (id) =>
    Effect.sync(() => {
      unliked.push(id);
    }),
  follow: () => Effect.void,
  unfollow: () => Effect.void,
});

const layerTest = AutomationEngine.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      RuleStore.layer,
      PeopleStore.layer,
      ObservationStore.layer,
      SettingsStore.layer,
      Events.layer,
      xExtraStub,
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        userPosts: () => Effect.succeed({ items: timeline, nextCursor: null, fromCache: true }),
        like: (id) =>
          failLikes
            ? Effect.fail(down)
            : Effect.sync(() => {
                liked.push(id);
              }),
        deletePost: (id) =>
          deleted.length === 1
            ? Effect.fail(down)
            : Effect.sync(() => {
                deleted.push(id);
              }),
      }),
    ),
  ),
);

const likeRule = (patch: Partial<RuleInput>): RuleInput => ({
  name: "like-hot",
  enabled: true,
  trigger: { kind: "post_crosses_threshold", metric: "views", threshold: 1000 },
  conditions: {},
  waitMinutes: 0,
  action: { kind: "auto_like" },
  budgetUsdDay: 1,
  budgetUsdMonth: 1,
  undoAfterHours: null,
  askFirst: false,
  dryRun: false,
  ...patch,
});

const setup = Effect.gen(function* () {
  liked.length = 0;
  unliked.length = 0;
  deleted.length = 0;
  failLikes = false;
  const settings = yield* SettingsStore.SettingsStore;
  yield* settings.update({ handle: "siam" });
  const rules = yield* RuleStore.RuleStore;
  const engine = yield* AutomationEngine.AutomationEngine;
  return { rules, engine };
});

describe("AutomationEngine", () => {
  it.live("threshold rules see only posts newer than the rule or the last 24h", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({}));
      const runs = yield* engine.runRule(rule.id);
      expect(runs.map((r) => r.subjectId)).toEqual(["fresh"]);
      expect(liked).toEqual(["fresh"]);
      expect(runs[0]?.xId).toBe("fresh");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("marks a subject fired only on success; dry runs and failures leave it open", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({ dryRun: true }));
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("dry_run");
      expect(yield* rules.firedSubjects(rule.id)).toEqual(new Set());

      yield* rules.upsert({ ...likeRule({}), id: rule.id });
      failLikes = true;
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("failed");
      expect(yield* rules.firedSubjects(rule.id)).toEqual(new Set());

      failLikes = false;
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("ok");
      expect(yield* rules.firedSubjects(rule.id)).toEqual(new Set(["fresh"]));
      expect(yield* engine.runRule(rule.id)).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("re-reads the rule budget per subject and logs the cost up to a failure", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const del = yield* rules.upsert({
        ...likeRule({ name: "clean" }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_delete", olderThanDays: 1, maxViews: 10_000 },
      });
      const runs = yield* engine.runRule(del.id);
      // Two stale posts; the second delete fails, so one delete's cost is logged and the slot stays open.
      expect(runs[0]?.status).toBe("failed");
      expect(runs[0]?.costUsd).toBeCloseTo(0.01);
      expect((yield* rules.get(del.id)).spentUsdMonth).toBeCloseTo(0.01);
      expect((yield* rules.get(del.id)).spentUsdDay).toBeCloseTo(0.01);
      // The next subject in the same batch sees that spend: a 0.015 budget now refuses the rule.
      yield* rules.upsert({ ...del, id: del.id, budgetUsdMonth: 0.015 });
      deleted.length = 0;
      expect((yield* engine.runRule(del.id))[0]?.status).toBe("skipped");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the per-day cap refuses before the month cap does", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({ budgetUsdDay: 0.01 }));
      const runs = yield* engine.runRule(rule.id);
      expect(runs[0]?.status).toBe("skipped");
      expect(runs[0]?.detail).toContain("day budget");
      expect(liked).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("account-level actions fire once per tick and cover every matched subject", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // Three posts over threshold in the window would be three subjects; auto_delete runs once.
      const rule = yield* rules.upsert({
        ...likeRule({ name: "prune", dryRun: true }),
        trigger: { kind: "post_crosses_threshold", metric: "views", threshold: 0 },
        action: { kind: "auto_delete", olderThanDays: 365, maxViews: 10 },
      });
      const runs = yield* engine.runRule(rule.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("skipped");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("conditions and wait filter subjects before anything is logged", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // "fresh" has no link; the only linked post is outside the 24h window.
      const linked = yield* rules.upsert(likeRule({ conditions: { link: "has" } }));
      expect(yield* engine.runRule(linked.id)).toEqual([]);
      // A 3h wait holds the 2h-old post back; a 1h wait lets it through.
      const waiting = yield* rules.upsert(likeRule({ name: "wait", waitMinutes: 180 }));
      expect(yield* engine.runRule(waiting.id)).toEqual([]);
      yield* rules.upsert({ ...waiting, id: waiting.id, waitMinutes: 60 });
      expect((yield* engine.runRule(waiting.id)).map((r) => r.subjectId)).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("ask-first queues a pending request, approving performs it, dismissing closes it", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({ askFirst: true }));
      const runs = yield* engine.runRule(rule.id);
      expect(runs[0]?.status).toBe("pending");
      expect(liked).toEqual([]);
      const queue = yield* rules.pendingList;
      expect(queue).toHaveLength(1);
      expect(queue[0]?.costUsd).toBeCloseTo(0.015);
      // The open request keeps the subject out of the next tick.
      expect(yield* engine.runRule(rule.id)).toEqual([]);

      const run = yield* engine.approve(queue[0]!.id);
      expect(run.status).toBe("ok");
      expect(liked).toEqual(["fresh"]);
      expect(yield* rules.pendingList).toEqual([]);
      expect(yield* rules.firedSubjects(rule.id)).toEqual(new Set(["fresh"]));

      // A dismissed request never comes back.
      const other = yield* rules.upsert(likeRule({ name: "other", askFirst: true }));
      yield* engine.runRule(other.id);
      yield* engine.dismiss((yield* rules.pendingList)[0]!.id);
      expect(yield* engine.runRule(other.id)).toEqual([]);
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("undoAfterHours schedules the inverse and the tick runs it when due", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({ undoAfterHours: 0 }));
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("ok");
      expect(unliked).toEqual([]);
      yield* engine.tick;
      expect(unliked).toEqual(["fresh"]);
      const undoRun = (yield* rules.runs({ ruleId: rule.id })).find((r) =>
        r.subjectId.startsWith("undo:"),
      );
      expect(undoRun?.status).toBe("ok");
      expect(undoRun?.xId).toBe("fresh");
      yield* engine.tick;
      expect(unliked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the 7-day dry run replays observed posts through the conditions and prices them", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const observations = yield* ObservationStore.ObservationStore;
      const observed = (p: XPost) => ({
        postId: p.postId,
        author: { userId: "1", handle: "siam", name: "Siam", followers: 10, verified: false },
        text: p.text,
        createdAt: p.createdAt,
        isReply: false,
        isRepost: false,
        isPromoted: false,
        hasMedia: false,
        hasLink: p.hasLink,
        metrics: p.metrics,
      });
      yield* observations.record({
        viewerHandle: "siam",
        source: "profile",
        observedAt: ago(0),
        posts: [...timeline, post("ancient", 30 * 24 * HOUR, 9000)].map(observed),
      });
      const rule = yield* rules.upsert(likeRule({}));
      const report = yield* engine.dryRun7d(rule.id);
      // Three posts inside 7 days, newest first; the 30-day-old one is out.
      expect(report.fired.map((f) => f.description)).toEqual([
        "own post fresh at 5000 views",
        "own post day at 5000 views",
        "own post old at 5000 views",
      ]);
      expect(report.totalUsd).toBeCloseTo(0.045);
      const linked = yield* rules.upsert(likeRule({ name: "linked", conditions: { link: "has" } }));
      expect((yield* engine.dryRun7d(linked.id)).fired.map((f) => f.description)).toEqual([
        "own post day at 5000 views",
      ]);
      expect(liked).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );
});

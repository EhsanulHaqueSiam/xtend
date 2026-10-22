import { describe, expect, it } from "@effect/vitest";
import { type RuleInput, XApiError, type XPost } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as AutomationEngine from "./AutomationEngine.ts";
import * as RuleStore from "./RuleStore.ts";

const HOUR = 3_600_000;
const post = (postId: string, ageMs: number, views: number): XPost => ({
  postId,
  url: `https://x.com/siam/status/${postId}`,
  text: "t",
  createdAt: DateTime.formatIso(DateTime.subtractDuration(DateTime.nowUnsafe(), Duration.millis(ageMs))),
  lang: null,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: "1", handle: "siam", name: "Siam", followers: 10, verified: false, avatarUrl: null },
  metrics: { views, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

// Own timeline: one post from last week, one from 2 hours ago, one from 30 hours ago; all over threshold.
const timeline = [post("old", 7 * 24 * HOUR, 5000), post("fresh", 2 * HOUR, 5000), post("day", 30 * HOUR, 5000)];
const liked: Array<string> = [];
const deleted: Array<string> = [];
let failLikes = false;

const layerTest = AutomationEngine.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(RuleStore.layer, ObservationStore.layer, SettingsStore.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        userPosts: () => Effect.succeed({ items: timeline, nextCursor: null, fromCache: true }),
        like: (id) =>
          failLikes
            ? Effect.fail(new XApiError({ endpoint: "x", reason: "provider", status: 500, detail: "down" }))
            : Effect.sync(() => {
                liked.push(id);
              }),
        deletePost: (id) =>
          deleted.length === 1
            ? Effect.fail(new XApiError({ endpoint: "x", reason: "provider", status: 500, detail: "down" }))
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
  action: { kind: "auto_like" },
  budgetUsdMonth: 1,
  dryRun: false,
  ...patch,
});

describe("AutomationEngine", () => {
  it.live("threshold rules see only posts newer than the rule or the last 24h", () =>
    Effect.gen(function* () {
      liked.length = 0;
      failLikes = false;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ handle: "siam" });
      const rules = yield* RuleStore.RuleStore;
      const engine = yield* AutomationEngine.AutomationEngine;
      const rule = yield* rules.upsert(likeRule({}));
      const runs = yield* engine.runRule(rule.id);
      expect(runs.map((r) => r.subjectId)).toEqual(["fresh"]);
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("marks a subject fired only on success; dry runs and failures leave it open", () =>
    Effect.gen(function* () {
      liked.length = 0;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ handle: "siam" });
      const rules = yield* RuleStore.RuleStore;
      const engine = yield* AutomationEngine.AutomationEngine;
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
      deleted.length = 0;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ handle: "siam" });
      const rules = yield* RuleStore.RuleStore;
      const engine = yield* AutomationEngine.AutomationEngine;
      const del = yield* rules.upsert({
        name: "clean",
        enabled: true,
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_delete", olderThanDays: 1, maxViews: 10_000 },
        budgetUsdMonth: 1,
        dryRun: false,
      });
      const runs = yield* engine.runRule(del.id);
      // Two stale posts; the second delete fails, so one delete's cost is logged and the slot stays open.
      expect(runs[0]?.status).toBe("failed");
      expect(runs[0]?.costUsd).toBeCloseTo(0.01);
      expect((yield* rules.get(del.id)).spentUsdMonth).toBeCloseTo(0.01);
      // The next subject in the same batch sees that spend: a 0.015 budget now refuses the rule.
      yield* rules.upsert({ ...del, id: del.id, budgetUsdMonth: 0.015 });
      deleted.length = 0;
      expect((yield* engine.runRule(del.id))[0]?.status).toBe("skipped");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("account-level actions fire once per tick and cover every matched subject", () =>
    Effect.gen(function* () {
      deleted.length = 0;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ handle: "siam" });
      const rules = yield* RuleStore.RuleStore;
      const engine = yield* AutomationEngine.AutomationEngine;
      // Three posts over threshold in the window would be three subjects; auto_delete runs once.
      const rule = yield* rules.upsert({
        name: "prune",
        enabled: true,
        trigger: { kind: "post_crosses_threshold", metric: "views", threshold: 0 },
        action: { kind: "auto_delete", olderThanDays: 365, maxViews: 10 },
        budgetUsdMonth: 1,
        dryRun: true,
      });
      const runs = yield* engine.runRule(rule.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("skipped");
    }).pipe(Effect.provide(layerTest)),
  );
});

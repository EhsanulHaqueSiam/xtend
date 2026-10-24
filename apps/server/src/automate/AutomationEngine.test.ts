import { describe, expect, it } from "@effect/vitest";
import {
  type AutomateError,
  type Candidate,
  type RuleInput,
  XApiError,
  type XPost,
} from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

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
import * as Webhooks from "./Webhooks.ts";

const HOUR = 3_600_000;
const ago = (ms: number) =>
  DateTime.formatIso(DateTime.subtractDuration(DateTime.nowUnsafe(), Duration.millis(ms)));
const post = (
  postId: string,
  ageMs: number,
  views: number,
  hasLink = false,
  handle = "siam",
): XPost => ({
  postId,
  url: `https://x.com/${handle}/status/${postId}`,
  text: "t",
  createdAt: ago(ageMs),
  lang: null,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink,
  author: {
    userId: handle === "siam" ? "1" : `id-${handle}`,
    handle,
    name: handle,
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
const reposted: Array<string> = [];
const followed: Array<string> = [];
const replies: Array<string> = [];
const calls = { userPosts: 0, engagers: 0, search: 0 };
const fake = {
  likeError: null as XApiError | null,
  unlikeError: null as XApiError | null,
  deleteErrors: {} as Record<string, XApiError>,
  failTimeline: false,
  timelineCached: true,
  /** More own-timeline items after the three above. */
  timelineExtra: [] as Array<XPost>,
  // Sleeps inside X calls, so concurrent runs interleave the way slow network calls do.
  slow: false,
  searchResults: [] as Array<XPost>,
  /** Whether a search is served from treg's read cache, and so free. */
  searchCached: true,
  /** What `x.cached.search` answers. False by default, so dry runs fall back to the session view. */
  searchPeek: false,
  engagers: [] as Array<Candidate>,
  followers: [] as Array<{ userId: string; handle: string }>,
  onLike: Effect.void as Effect.Effect<unknown, AutomateError>,
};
const latency = Effect.suspend(() => (fake.slow ? Effect.sleep("10 millis") : Effect.void));

const down = new XApiError({ endpoint: "x", reason: "provider", status: 500, detail: "down" });
const timedOut = new XApiError({
  endpoint: "x",
  reason: "http",
  status: null,
  detail: "no answer",
});
const refusedBy = (status: number) =>
  new XApiError({ endpoint: "x", reason: "provider", status, detail: "refused" });

const xExtraStub = Layer.succeed(XExtra.XExtra)({
  engagers: (_postId, via) =>
    Effect.sync(() => {
      calls.engagers++;
      return { matches: fake.engagers, costUsd: XExtra.engagersCostUsd(via) };
    }),
  unrepost: () => Effect.void,
  unlike: (id) =>
    fake.unlikeError === null
      ? Effect.sync(() => {
          unliked.push(id);
        })
      : Effect.fail(fake.unlikeError),
  follow: (id) =>
    Effect.sync(() => {
      followed.push(id);
    }),
  unfollow: () => Effect.void,
});

const layerTest = AutomationEngine.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      RuleStore.layer,
      PeopleStore.layer,
      ObservationStore.layer,
      Events.layer,
      xExtraStub,
    ),
  ),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        userPosts: () =>
          Effect.gen(function* () {
            calls.userPosts++;
            yield* latency;
            if (fake.failTimeline) return yield* Effect.fail(down);
            return {
              items: [...timeline, ...fake.timelineExtra],
              nextCursor: null,
              fromCache: fake.timelineCached,
            };
          }),
        searchPosts: () =>
          Effect.sync(() => {
            calls.search++;
            return { items: fake.searchResults, nextCursor: null, fromCache: fake.searchCached };
          }),
        followers: () =>
          Effect.sync(() => ({
            items: fake.followers.map((f) => ({
              ...f,
              name: f.handle,
              followers: 0,
              following: 0,
              verified: false,
              bio: "",
              createdAt: null,
            })),
            nextCursor: null,
            fromCache: false,
          })),
        like: (id) =>
          fake.likeError !== null
            ? Effect.fail(fake.likeError)
            : latency.pipe(
                Effect.andThen(Effect.orDie(fake.onLike)),
                Effect.andThen(
                  Effect.sync(() => {
                    liked.push(id);
                  }),
                ),
              ),
        repost: (id) =>
          Effect.sync(() => {
            reposted.push(id);
          }),
        createPost: (input) =>
          Effect.sync(() => {
            replies.push(input.replyToPostId ?? "");
            return { postId: `reply-${replies.length}`, costUsd: 0.015 };
          }),
        deletePost: (id) =>
          fake.deleteErrors[id] === undefined
            ? Effect.sync(() => {
                deleted.push(id);
              })
            : Effect.fail(fake.deleteErrors[id]),
        cached: {
          search: () => Effect.sync(() => fake.searchPeek),
          profile: () => Effect.succeed(false),
          userPosts: () => Effect.sync(() => fake.timelineCached),
          followers: () => Effect.succeed(false),
          trending: () => Effect.succeed(false),
          me: Effect.succeed(false),
          mentions: () => Effect.succeed(false),
        },
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
  for (const list of [liked, unliked, deleted, reposted, followed, replies]) list.length = 0;
  Object.assign(calls, { userPosts: 0, engagers: 0, search: 0 });
  Object.assign(fake, {
    likeError: null,
    unlikeError: null,
    deleteErrors: {},
    failTimeline: false,
    timelineCached: true,
    timelineExtra: [],
    slow: false,
    searchResults: [],
    searchCached: true,
    searchPeek: false,
    engagers: [],
    followers: [],
    onLike: Effect.void,
  });
  const settings = yield* SettingsStore.SettingsStore;
  yield* settings.update({ handle: "siam" });
  const rules = yield* RuleStore.RuleStore;
  const engine = yield* AutomationEngine.AutomationEngine;
  return { rules, engine };
});

const observed = (p: XPost) => ({
  postId: p.postId,
  author: {
    userId: p.author.userId,
    handle: p.author.handle,
    name: p.author.name,
    followers: p.author.followers,
    verified: false,
  },
  text: p.text,
  createdAt: p.createdAt,
  isReply: p.isReply,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: p.hasLink,
  metrics: p.metrics,
});
const observe = (posts: ReadonlyArray<XPost>) =>
  Effect.gen(function* () {
    const store = yield* ObservationStore.ObservationStore;
    yield* store.record({
      viewerHandle: "siam",
      source: "profile",
      observedAt: ago(0),
      posts: posts.map(observed),
    });
  });

const webhookCalls = (ruleId: number, n: number) =>
  Effect.gen(function* () {
    const rules = yield* RuleStore.RuleStore;
    const { secret } = yield* rules.webhook(ruleId);
    for (let i = 0; i < n; i++) {
      const body = `{"n":${i}}`;
      yield* Webhooks.handleWebhook(ruleId, Webhooks.sign(secret, body), body);
    }
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
      fake.likeError = down;
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("failed");
      expect(yield* rules.firedSubjects(rule.id)).toEqual(new Set());

      fake.likeError = null;
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
      fake.deleteErrors = { day: down };
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

  it.live("the per-day cap refuses before the month cap does, and the refusal is logged once", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({ budgetUsdDay: 0.01 }));
      const runs = yield* engine.runRule(rule.id);
      expect(runs[0]?.status).toBe("skipped");
      expect(runs[0]?.detail).toContain("day budget");
      expect(liked).toEqual([]);
      // Held back every minute, the subject keeps one log row rather than one per tick.
      yield* engine.runRule(rule.id);
      yield* engine.runRule(rule.id);
      expect(yield* rules.runs({ ruleId: rule.id })).toHaveLength(1);
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

  it.live("an ask-first account-level action asks once however many subjects match", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert({
        ...likeRule({ name: "boost", askFirst: true }),
        trigger: { kind: "webhook" },
        action: { kind: "auto_retweet", evergreen: false },
      });
      yield* webhookCalls(rule.id, 3);
      expect((yield* engine.runRule(rule.id)).map((r) => r.status)).toEqual(["pending"]);
      expect(yield* engine.runRule(rule.id)).toEqual([]);
      expect(yield* rules.pendingList).toHaveLength(1);

      yield* engine.approve((yield* rules.pendingList)[0]!.id);
      expect(reposted).toHaveLength(1);
      // The approved firing covered all three calls: nothing is asked or reposted again.
      expect(yield* engine.runRule(rule.id)).toEqual([]);
      expect(yield* rules.pendingList).toEqual([]);
      expect(reposted).toHaveLength(1);
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

  it.live("a minimum-followers condition judges the engager a polled trigger found", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.engagers = [
        { handle: "small", name: "Small", userId: "100", followers: 50, bio: "" },
        { handle: "big", name: "Big", userId: "200", followers: 5000, bio: "" },
      ];
      const rule = yield* rules.upsert({
        ...likeRule({ name: "follow-back", conditions: { minAuthorFollowers: 1000 } }),
        trigger: { kind: "post_engaged", postId: "42", via: "repost" },
        action: { kind: "follow" },
      });
      const runs = yield* engine.runRule(rule.id);
      expect(followed).toEqual(["200"]);
      expect(runs.map((r) => r.subjectId)).toEqual(["repost:200"]);
      // The poll's own price counts against the rule beside the follow.
      expect((yield* rules.get(rule.id)).spentUsdDay).toBeCloseTo(0.001 + 0.015);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a trigger poll the rule's caps cannot cover is refused and logged once", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // Twenty likers at $0.01 each is $0.20 a poll, over this $0.10 day cap.
      const rule = yield* rules.upsert({
        ...likeRule({ name: "likers", budgetUsdDay: 0.1 }),
        trigger: { kind: "post_engaged", postId: "42", via: "like" },
        action: { kind: "follow" },
      });
      yield* engine.runRule(rule.id);
      yield* engine.runRule(rule.id);
      expect(calls.engagers).toBe(0);
      const runs = yield* rules.runs({ ruleId: rule.id });
      expect(runs.map((r) => [r.subjectId, r.status])).toEqual([["poll", "skipped"]]);
      expect(runs[0]?.detail).toContain("day budget");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a keyword rule's search counts against its caps, which refuse it once spent", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // Room for one $0.00075 search a day, not two.
      const rule = yield* rules.upsert({
        ...likeRule({ name: "kw-notify", budgetUsdDay: 0.001 }),
        trigger: { kind: "keyword_post", query: "growth" },
        action: { kind: "notify", message: "seen" },
      });
      // One the read cache served cost nothing.
      yield* engine.runRule(rule.id);
      expect((yield* rules.get(rule.id)).spentUsdDay).toBe(0);
      fake.searchCached = false;
      yield* engine.runRule(rule.id);
      expect((yield* rules.get(rule.id)).spentUsdDay).toBeCloseTo(0.00075);
      yield* engine.runRule(rule.id);
      yield* engine.runRule(rule.id);
      expect(calls.search).toBe(2);
      const runs = yield* rules.runs({ ruleId: rule.id });
      expect(runs.map((r) => [r.subjectId, r.status])).toEqual([["poll", "skipped"]]);
      expect(runs[0]?.detail).toContain("day budget");

      // Spent, it still reads a search another rule left in the cache: that one is free.
      Object.assign(fake, { searchPeek: true, searchCached: true });
      yield* engine.runRule(rule.id);
      expect(calls.search).toBe(3);
      expect((yield* rules.get(rule.id)).spentUsdDay).toBeCloseTo(0.00075);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live(
    "an own-timeline read counts against the rule that made it, whose caps refuse it once spent",
    () =>
      Effect.gen(function* () {
        const { rules, engine } = yield* setup;
        // Room for one $0.00075 timeline read a day, not two.
        const watch = yield* rules.upsert({
          ...likeRule({ name: "hot-notify", budgetUsdDay: 0.001 }),
          action: { kind: "notify", message: "hot" },
        });
        // Room for the $0.015 repost, but not for the read that picks the post as well.
        const boost = yield* rules.upsert({
          ...likeRule({ name: "boost", budgetUsdDay: 0.0155 }),
          trigger: { kind: "webhook" },
          action: { kind: "auto_retweet", evergreen: false },
        });
        // One the read cache served cost nothing.
        yield* engine.runRule(watch.id);
        expect((yield* rules.get(watch.id)).spentUsdDay).toBe(0);
        fake.timelineCached = false;
        yield* engine.runRule(watch.id);
        expect((yield* rules.get(watch.id)).spentUsdDay).toBeCloseTo(0.00075);

        // The repost action's read is the boost rule's, and its cap then has no room for the repost.
        yield* webhookCalls(boost.id, 1);
        const [boosted] = yield* engine.runRule(boost.id);
        expect([boosted?.status, boosted?.detail]).toEqual([
          "skipped",
          "day budget: $0.001 spent of $0.0155",
        ]);
        expect(reposted).toEqual([]);
        expect((yield* rules.get(boost.id)).spentUsdDay).toBeCloseTo(0.00075);
        expect((yield* rules.get(watch.id)).spentUsdDay).toBeCloseTo(0.00075);

        // Spent, the watcher's next read is refused and logged once; what the session saw still counts.
        yield* observe([post("seen", HOUR, 9000)]);
        yield* engine.runRule(watch.id);
        yield* engine.runRule(watch.id);
        expect(calls.userPosts).toBe(3);
        const runs = yield* rules.runs({ ruleId: watch.id });
        expect(runs.map((r) => [r.subjectId, r.status])).toEqual([
          ["seen", "ok"],
          ["poll", "skipped"],
          ["fresh", "ok"],
        ]);
        expect(runs[1]?.detail).toContain("day budget");
      }).pipe(Effect.provide(layerTest)),
  );

  it.live("a dry run makes no paid reads: no poll, no uncached timeline", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.timelineCached = false;
      yield* observe([post("seen", 1 * HOUR, 9000)]);
      const likers = yield* rules.upsert({
        ...likeRule({ name: "likers", dryRun: true }),
        trigger: { kind: "post_engaged", postId: "42", via: "like" },
        action: { kind: "follow" },
      });
      const hot = yield* rules.upsert(likeRule({ dryRun: true }));
      fake.searchCached = false;
      const keyword = yield* rules.upsert({
        ...likeRule({ name: "kw", dryRun: true }),
        trigger: { kind: "keyword_post", query: "growth" },
      });
      yield* engine.runRule(keyword.id);
      yield* engine.runRule(likers.id);
      // The session view saw "seen"; the scraper timeline holding "fresh" was not bought.
      const runs = yield* engine.runRule(hot.id);
      expect(runs.map((r) => [r.subjectId, r.status])).toEqual([["seen", "dry_run"]]);
      expect(calls).toEqual({ userPosts: 0, engagers: 0, search: 0 });
      expect((yield* rules.get(likers.id)).spentUsdDay).toBe(0);
      expect((yield* rules.get(keyword.id)).spentUsdDay).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("an auto plug never answers the user's own posts or replies", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // A plug carrying the keyword shows up in the keyword search; it must not be plugged again.
      fake.searchResults = [post("mine", HOUR, 10), post("theirs", HOUR, 10, false, "alice")];
      const keyword = yield* rules.upsert({
        ...likeRule({ name: "kw" }),
        trigger: { kind: "keyword_post", query: "growth" },
        action: { kind: "auto_plug", text: "my growth guide" },
      });
      yield* engine.runRule(keyword.id);
      expect(replies).toEqual(["theirs"]);

      // An own reply that crossed the threshold (an earlier plug riding the post's reach) is not plugged.
      yield* observe([{ ...post("plug", HOUR, 9000), isReply: true }]);
      const threshold = yield* rules.upsert({
        ...likeRule({ name: "plug-hot" }),
        action: { kind: "auto_plug", text: "my guide" },
      });
      yield* engine.runRule(threshold.id);
      expect(replies).toEqual(["theirs", "fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("own-post triggers and actions leave out the user's reposts of other people", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // A viral post the user reposted shows on their timeline with the original's reach.
      fake.timelineExtra = [
        { ...post("rt", HOUR, 900_000), text: "RT @alice: viral", isRepost: true },
      ];
      const hot = yield* rules.upsert(likeRule({}));
      yield* engine.runRule(hot.id);
      expect(liked).toEqual(["fresh"]);
      const boost = yield* rules.upsert({
        ...likeRule({ name: "boost" }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_retweet", evergreen: false },
      });
      yield* engine.runRule(boost.id);
      expect(reposted).toEqual(["old"]);
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

  it.live("approving twice at once performs the action once", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.slow = true;
      const rule = yield* rules.upsert(likeRule({ askFirst: true }));
      yield* engine.runRule(rule.id);
      const id = (yield* rules.pendingList)[0]!.id;
      const [first, second] = yield* Effect.all(
        [Effect.result(engine.approve(id)), Effect.result(engine.approve(id))],
        { concurrency: 2 },
      );
      expect([first._tag, second._tag].sort()).toEqual(["Failure", "Success"]);
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("an approval only buys the price it showed; a plan that grew asks again", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert({
        ...likeRule({ name: "prune", askFirst: true }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_delete", olderThanDays: 1, maxViews: 10_000 },
      });
      yield* engine.runRule(rule.id);
      const asked = (yield* rules.pendingList)[0]!;
      expect(asked.costUsd).toBeCloseTo(0.02);
      // Since asking, the age limit was lowered: three posts now match, not two.
      yield* rules.upsert({
        ...rule,
        id: rule.id,
        action: { kind: "auto_delete", olderThanDays: 0, maxViews: 10_000 },
      });
      const run = yield* engine.approve(asked.id);
      expect(run.status).toBe("skipped");
      expect(deleted).toEqual([]);
      yield* engine.runRule(rule.id);
      expect((yield* rules.pendingList).map((p) => p.costUsd)).toEqual([0.03]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("Run now during a tick's firing of the same rule does not act twice", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.slow = true;
      const rule = yield* rules.upsert(likeRule({}));
      yield* Effect.all([engine.runRule(rule.id), engine.runRule(rule.id)], { concurrency: 2 });
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("switching a rule off stops the batch it is firing", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.searchResults = ["a", "b", "c"].map((h) => post(`p-${h}`, HOUR, 10, false, h));
      const rule = yield* rules.upsert({
        ...likeRule({ name: "kw-like" }),
        trigger: { kind: "keyword_post", query: "growth" },
      });
      fake.onLike = rules.upsert({ ...likeRule({}), ...rule, id: rule.id, enabled: false });
      yield* engine.tick;
      expect(liked).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a rule whose action fails to plan is logged and the tick goes on", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.searchResults = [post("p-a", HOUR, 10, false, "alice")];
      const keyword = yield* rules.upsert({
        ...likeRule({ name: "kw-like" }),
        trigger: { kind: "keyword_post", query: "growth" },
      });
      // Newest rule runs first; picking its post needs the timeline, which is down.
      fake.failTimeline = true;
      const boost = yield* rules.upsert({
        ...likeRule({ name: "boost" }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_retweet", evergreen: true },
      });
      yield* engine.tick;
      expect((yield* rules.runs({ ruleId: boost.id })).map((r) => r.status)).toEqual(["failed"]);
      expect(liked).toEqual(["p-a"]);
      expect((yield* rules.runs({ ruleId: keyword.id })).map((r) => r.status)).toEqual(["ok"]);
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

  it.live("another account's rules, runs, requests and undos stay out of reach", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const asking = yield* rules.upsert(likeRule({ name: "ask", askFirst: true }));
      yield* engine.runRule(asking.id);
      const undoing = yield* rules.upsert(likeRule({ undoAfterHours: 0 }));
      yield* engine.runRule(undoing.id);
      const requestId = (yield* rules.pendingList)[0]!.id;

      yield* sql`INSERT INTO accounts (id, handle, label, created_at) VALUES (2, 'ghost', 'Ghost', ${ago(0)})`;
      yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
      expect(yield* rules.list).toEqual([]);
      expect(yield* rules.runs({})).toEqual([]);
      expect(yield* rules.pendingList).toEqual([]);
      // The X connection now acts as the other account: nothing of the first may run through it.
      expect((yield* Effect.result(engine.approve(requestId)))._tag).toBe("Failure");
      expect((yield* Effect.result(engine.runRule(undoing.id)))._tag).toBe("Failure");
      expect((yield* Effect.result(rules.upsert({ ...asking, enabled: false })))._tag).toBe(
        "Failure",
      );
      yield* engine.tick;
      expect(unliked).toEqual([]);

      yield* sql`UPDATE settings SET current_account_id = 1 WHERE id = 1`;
      expect((yield* rules.get(asking.id)).enabled).toBe(true);
      yield* engine.tick;
      expect(unliked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the 7-day dry run replays observed posts through the conditions and prices them", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      yield* observe([...timeline, post("ancient", 30 * 24 * HOUR, 9000)]);
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

  it.effect("a schedule fires once per local day, on the user's weekday and clock", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      yield* (yield* SettingsStore.SettingsStore).update({ timeZone: "Asia/Tokyo" });
      // Saturday 22:30 in UTC is Sunday 07:30 in Tokyo.
      yield* TestClock.setTime(Date.parse("2026-10-24T22:30:00.000Z"));
      const slot = (weekdays: ReadonlyArray<number>, time: string) =>
        rules.upsert({
          ...likeRule({ name: `at ${time}` }),
          trigger: { kind: "schedule", weekdays, time },
          action: { kind: "notify", message: "tick" },
        });
      const sunday = yield* slot([0], "07:00");
      const saturday = yield* slot([6], "22:00");
      const later = yield* slot([0], "08:00");
      const fired = (id: number) =>
        Effect.map(engine.runRule(id), (runs) => runs.map((r) => r.subjectId));
      expect(yield* fired(sunday.id)).toEqual(["2026-10-25 07:00"]);
      expect(yield* fired(saturday.id)).toEqual([]);
      expect(yield* fired(later.id)).toEqual([]);
      expect(yield* fired(sunday.id)).toEqual([]);
      // A week on, the same slot fires again.
      yield* TestClock.adjust("7 days");
      expect(yield* fired(sunday.id)).toEqual(["2026-11-01 07:00"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the 7-day dry run places schedule slots in the user's time zone", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const timeZone = "Pacific/Kiritimati";
      yield* (yield* SettingsStore.SettingsStore).update({ timeZone });
      const rule = yield* rules.upsert({
        ...likeRule({ name: "nightly" }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "23:59" },
        action: { kind: "notify", message: "tick" },
      });
      const now = Date.now();
      const { fired } = yield* engine.dryRun7d(rule.id);
      // One slot a day, each at 23:59 local on the local date it names, none still to come.
      expect(fired).toHaveLength(7);
      for (const f of fired) {
        const local = DateTime.setZone(DateTime.makeUnsafe(f.at), SettingsStore.zoneOf(timeZone));
        const parts = DateTime.toParts(local);
        expect([parts.hour, parts.minute]).toEqual([23, 59]);
        expect(f.description).toBe(`schedule slot ${DateTime.formatIsoDate(local)} 23:59`);
        expect(Date.parse(f.at)).toBeLessThanOrEqual(now);
      }
    }).pipe(Effect.provide(layerTest)),
  );
  it.live("a dry-run rule logs what it would do once and spends none of its caps", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // Two likes' worth of day cap: phantom spend would leave the rule refused once it goes live.
      const rule = yield* rules.upsert(likeRule({ dryRun: true, budgetUsdDay: 0.02 }));
      for (let i = 0; i < 3; i++) yield* engine.runRule(rule.id);
      const runs = yield* rules.runs({ ruleId: rule.id });
      expect(runs.map((r) => [r.status, r.costUsd])).toEqual([["dry_run", 0.015]]);
      expect((yield* rules.get(rule.id)).spentUsdDay).toBe(0);

      yield* rules.upsert({ ...rule, id: rule.id, dryRun: false });
      expect((yield* engine.runRule(rule.id))[0]?.status).toBe("ok");
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("an action that timed out or that X refused is not retried; an outage is", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      // No answer: the like may be on X, so trying again could act twice. Treg charged the quote.
      fake.likeError = timedOut;
      const unsure = yield* rules.upsert(likeRule({ name: "unsure" }));
      const [run] = yield* engine.runRule(unsure.id);
      expect(run?.status).toBe("failed");
      expect(run?.detail).toContain("not retried");
      expect((yield* rules.get(unsure.id)).spentUsdDay).toBeCloseTo(0.015);
      fake.likeError = null;
      expect(yield* engine.runRule(unsure.id)).toEqual([]);

      // X said no (a duplicate, a DM the person does not take); it would say no every minute.
      fake.likeError = refusedBy(403);
      const refused = yield* rules.upsert(likeRule({ name: "refused" }));
      expect((yield* engine.runRule(refused.id))[0]?.status).toBe("failed");
      fake.likeError = null;
      expect(yield* engine.runRule(refused.id)).toEqual([]);

      // Rate limited: nothing happened, so the next tick tries again.
      fake.likeError = refusedBy(429);
      const limited = yield* rules.upsert(likeRule({ name: "limited" }));
      expect((yield* engine.runRule(limited.id))[0]?.status).toBe("failed");
      fake.likeError = null;
      expect((yield* engine.runRule(limited.id))[0]?.status).toBe("ok");
      expect(liked).toEqual(["fresh"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a firing cut off mid-call, as by a restart, is not repeated", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert(likeRule({}));
      fake.onLike = Effect.never;
      const fiber = yield* engine
        .runRule(rule.id)
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Effect.sleep("20 millis");
      yield* Fiber.interrupt(fiber);
      fake.onLike = Effect.void;
      expect(yield* engine.runRule(rule.id)).toEqual([]);
      expect(liked).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the tick does not run a rule switched off while it was busy with another", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const later = yield* rules.upsert({
        ...likeRule({ name: "boost" }),
        trigger: { kind: "schedule", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00" },
        action: { kind: "auto_retweet", evergreen: false },
      });
      // Newest first: the keyword rule fires first, and mid-like the user switches "boost" off.
      fake.searchResults = [post("p-a", HOUR, 10, false, "alice")];
      yield* rules.upsert({
        ...likeRule({ name: "kw-like" }),
        trigger: { kind: "keyword_post", query: "growth" },
      });
      fake.onLike = rules.upsert({ ...later, id: later.id, enabled: false });
      yield* engine.tick;
      expect(liked).toEqual(["p-a"]);
      expect(reposted).toEqual([]);
      expect(yield* rules.runs({ ruleId: later.id })).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live(
    "a new-follower rule takes the account's first follower check as who already followed",
    () =>
      Effect.gen(function* () {
        const { rules, engine } = yield* setup;
        const people = yield* PeopleStore.PeopleStore;
        fake.followers = [
          { userId: "10", handle: "old1" },
          { userId: "11", handle: "old2" },
        ];
        const rule = yield* rules.upsert({
          ...likeRule({ name: "welcome" }),
          trigger: { kind: "new_follower" },
          action: { kind: "follow" },
        });
        // Both followed before the rule existed, though this poll is the first to see them.
        expect(yield* engine.runRule(rule.id)).toEqual([]);
        yield* Effect.sleep("5 millis");
        // A later check (the Leads tab, or the next poll) finds someone new.
        yield* people.markFollowersSeen([{ userId: "12", handle: "new1" }, ...fake.followers]);
        expect((yield* engine.runRule(rule.id)).map((r) => r.subjectId)).toEqual(["12"]);
        expect(followed).toEqual(["12"]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.live("auto delete never pays to delete a post twice, nor one already deleted by hand", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const rule = yield* rules.upsert({
        ...likeRule({ name: "prune" }),
        trigger: { kind: "webhook" },
        action: { kind: "auto_delete", olderThanDays: 1, maxViews: 10_000 },
      });
      // "old" is gone from X since the timeline listed it.
      fake.deleteErrors = { old: refusedBy(404) };
      yield* webhookCalls(rule.id, 1);
      const [first] = yield* engine.runRule(rule.id);
      expect([first?.status, first?.costUsd]).toEqual(["ok", 0.02]);
      expect(deleted).toEqual(["day"]);
      // The timeline still lists both; the next firing finds nothing left to delete.
      yield* webhookCalls(rule.id, 1);
      expect((yield* engine.runRule(rule.id)).map((r) => [r.status, r.detail])).toEqual([
        ["skipped", "no post matches the age and view limits"],
      ]);
      expect(deleted).toEqual(["day"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("evaluating the enabled rules reads only what is stored or cached", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      fake.timelineCached = false;
      yield* observe([post("seen", HOUR, 9000)]);
      yield* rules.upsert(likeRule({}));
      yield* rules.upsert({
        ...likeRule({ name: "kw-like" }),
        trigger: { kind: "keyword_post", query: "growth" },
      });
      const rows = yield* engine.preview;
      expect(rows.map((r) => [r.ruleName, r.subjectId, r.costUsd])).toEqual([
        ["like-hot", "seen", 0.015],
      ]);
      expect(calls).toEqual({ userPosts: 0, engagers: 0, search: 0 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("an undo held up by an outage runs on a later tick; one X refuses is not retried", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const first = yield* rules.upsert(likeRule({ undoAfterHours: 0 }));
      yield* engine.runRule(first.id);
      fake.unlikeError = down;
      yield* engine.tick;
      expect(unliked).toEqual([]);
      fake.unlikeError = null;
      yield* engine.tick;
      expect(unliked).toEqual(["fresh"]);

      const second = yield* rules.upsert(likeRule({ name: "again", undoAfterHours: 0 }));
      yield* engine.runRule(second.id);
      fake.unlikeError = refusedBy(404);
      yield* engine.tick;
      fake.unlikeError = null;
      yield* engine.tick;
      expect(unliked).toEqual(["fresh"]);
      expect(
        (yield* rules.runs({ ruleId: second.id }))
          .filter((r) => r.subjectId.startsWith("undo:"))
          .map((r) => r.status),
      ).toEqual(["failed"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a notify action publishes its filled-in message for the shell to show", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      const events = yield* Events.Events;
      fake.engagers = [{ handle: "big", name: "Big", userId: "200", followers: 5000, bio: "" }];
      const rule = yield* rules.upsert({
        ...likeRule({ name: "thanks" }),
        trigger: { kind: "post_engaged", postId: "42", via: "repost" },
        action: { kind: "notify", message: "{name} reposted you" },
      });
      const seen = yield* events.stream.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      yield* engine.runRule(rule.id);
      const [event] = yield* Fiber.join(seen);
      expect(event?.type).toBe("rule_fired");
      expect(event?.payload["notify"]).toEqual({
        title: "thanks",
        body: "Big reposted you (@big reposted 42)",
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("the 7-day dry run of a keyword rule leaves out the user's own posts", () =>
    Effect.gen(function* () {
      const { rules, engine } = yield* setup;
      yield* observe([
        { ...post("mine", HOUR, 10), text: "my growth thread" },
        { ...post("theirs", HOUR, 10, false, "alice"), text: "a growth question" },
      ]);
      const rule = yield* rules.upsert({
        ...likeRule({ name: "kw" }),
        trigger: { kind: "keyword_post", query: "growth" },
        action: { kind: "auto_plug", text: "my growth guide" },
      });
      expect((yield* engine.dryRun7d(rule.id)).fired.map((f) => f.description)).toEqual([
        "@alice: a growth question",
      ]);
    }).pipe(Effect.provide(layerTest)),
  );
});

import { describe, expect, it } from "@effect/vitest";
import type { AccountPost, XPost, XProfile } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Assist from "../ai/Assist.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ScoreStore from "../scores/ScoreStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as Treg from "../x/Treg.ts";
import * as Analytics from "./Analytics.ts";
import { heatmapOf, summarize } from "./Analytics.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";
import * as PostAnalytics from "./PostAnalytics.ts";

const now = Date.parse("2026-10-22T12:00:00.000Z");
const DAY = 86_400_000;
const utc = DateTime.zoneMakeNamedUnsafe("UTC");
const post = (daysAgo: number, views: number | null, likes: number): AccountPost => ({
  postId: String(daysAgo),
  url: "u",
  text: "t",
  createdAt: DateTime.formatIso(DateTime.makeUnsafe(now - daysAgo * DAY)),
  kind: "text",
  views,
  likes,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
});

describe("Analytics.summarize", () => {
  it("weights engagement rate by views and groups views by the day posted", () => {
    const posts = [post(1, 10_000, 100), post(2, 100, 50), post(40, 1_000_000, 0)];
    const s = summarize(posts, [], now, utc);
    const week = s.windows.find((w) => w.days === 7)!;
    expect(week.posts).toBe(2);
    // 150 engagements over 10,100 views, not the mean of 1% and 50%.
    expect(week.engagementRate).toBeCloseTo(150 / 10_100);
    expect(s.viewsByPostDay.map((d) => d.views)).toEqual([100, 10_000]);
  });

  it("leaves a post X gave no view count out of the rate instead of inflating it", () => {
    const s = summarize([post(1, 1_000, 10), post(2, null, 500)], [], now, utc);
    const week = s.windows.find((w) => w.days === 7)!;
    expect(week.posts).toBe(2);
    expect(week.likes).toBe(510);
    expect(week.engagementRate).toBeCloseTo(0.01);
    expect(summarize([post(1, null, 5)], [], now, utc).windows[0]?.engagementRate).toBe(0);
  });

  it("files a post under the day it was posted in the account's zone, not UTC's", () => {
    const at = (createdAt: string, views: number): AccountPost => ({
      ...post(0, views, 0),
      createdAt,
    });
    // 23:30 UTC on the 20th is 10:30 on the 21st in Sydney; 01:00 UTC on the 21st is still the 20th in New York.
    const posts = [at("2026-10-20T23:30:00.000Z", 10), at("2026-10-21T01:00:00.000Z", 5)];
    const days = (zone: string) =>
      summarize(posts, [], now, DateTime.zoneMakeNamedUnsafe(zone)).viewsByPostDay;
    expect(days("Australia/Sydney")).toEqual([{ day: "2026-10-21", posts: 2, views: 15 }]);
    expect(days("America/New_York")).toEqual([{ day: "2026-10-20", posts: 2, views: 15 }]);
    expect(days("UTC").map((d) => d.day)).toEqual(["2026-10-20", "2026-10-21"]);
  });

  it("measures follower change against the snapshot at least 30 days old", () => {
    const snapshots = [
      { day: "2026-08-01", followers: 100, following: 1, posts: 1 },
      { day: "2026-09-20", followers: 150, following: 1, posts: 1 },
      { day: "2026-10-21", followers: 170, following: 1, posts: 1 },
      { day: "2026-10-22", followers: 180, following: 1, posts: 1 },
    ];
    expect(summarize([], snapshots, now, utc).followerDelta30d).toEqual({
      delta: 30,
      sinceDay: "2026-09-20",
    });
    expect(summarize([], snapshots.slice(2), now, utc).followerDelta30d).toBeNull();
  });
});

describe("Analytics.heatmapOf", () => {
  const at = (createdAt: string, views: number | null): AccountPost => ({
    ...post(0, views, 0),
    createdAt,
  });

  it("buckets by the account's local hour across a DST change and averages known views only", () => {
    const zone = DateTime.zoneMakeNamedUnsafe("America/New_York");
    // 10:30 local on both Saturdays: EDT (UTC-4) before the fall change, EST (UTC-5) after it.
    const cells = heatmapOf(
      [
        at("2026-10-31T14:30:00.000Z", 300),
        at("2026-11-07T15:30:00.000Z", 100),
        at("2026-11-07T15:45:00.000Z", null),
      ],
      zone,
    );
    expect(cells).toEqual([{ weekday: 6, hour: 10, posts: 3, avgViews: 200 }]);
  });
});

const ownPost = (postId: string, createdAt: string, views: number, isRepost = false): XPost => ({
  postId,
  url: `https://x.com/siam/status/${postId}`,
  text: isRepost ? "RT @ann: hello" : "hello",
  createdAt,
  lang: null,
  isReply: false,
  isRepost,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "1",
    handle: "siam",
    name: "Siam",
    followers: 500,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const profile: XProfile = {
  userId: "1",
  handle: "siam",
  name: "Siam",
  bio: "",
  followers: 500,
  following: 10,
  posts: 3,
  verified: false,
  avatarUrl: null,
  createdAt: null,
  location: null,
  website: null,
};

/** The timeline X serves, one page per cursor (the first page has none), and the cursors asked for. */
const timeline = new Map<string | undefined, { items: Array<XPost>; nextCursor: string | null }>();
const cursorsAsked: Array<string | undefined> = [];

const layerService = Analytics.layer.pipe(
  Layer.provideMerge(PostAnalytics.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      AnalyticsStore.layer,
      ScoreStore.layer,
      SettingsStore.layer,
      ObservationStore.layer,
      Layer.succeed(Assist.Assist)({ generate: () => Effect.die("no model here") }),
      Layer.succeed(Treg.Treg)({
        isCached: () => Effect.succeed(false),
        call: () => Effect.succeed({ status: 200, body: { data: [] }, costUsd: 0, cached: false }),
      }),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        profile: () => Effect.succeed(profile),
        userPosts: (_handle, { cursor }) =>
          Effect.sync(() => {
            cursorsAsked.push(cursor);
            return {
              ...(timeline.get(cursor) ?? { items: [], nextCursor: null }),
              fromCache: false,
            };
          }),
      }),
    ),
  ),
);

describe("Analytics service", () => {
  // The clock is set before the layer starts PostAnalytics' 5-minute loop, which would replay every tick since 1970.
  it.effect(
    "refresh reads the timeline until X runs out, keeps no reposts, days in the user's zone",
    () =>
      Effect.andThen(
        TestClock.setTime(Date.parse("2026-10-22T12:00:00.000Z")),
        Effect.gen(function* () {
          yield* (yield* SettingsStore.SettingsStore).update({
            handle: "siam",
            timeZone: "Australia/Sydney",
          });
          timeline.set(undefined, {
            items: [
              ownPost("1", "2026-10-20T23:30:00.000Z", 10),
              ownPost("2", "2026-10-20T23:40:00.000Z", 900, true),
            ],
            nextCursor: "c2",
          });
          timeline.set("c2", {
            items: [ownPost("3", "2026-10-21T01:00:00.000Z", 5)],
            nextCursor: null,
          });
          cursorsAsked.length = 0;

          const data = yield* (yield* Analytics.Analytics).refresh;
          expect(cursorsAsked).toEqual([undefined, "c2"]);
          expect(data.posts.map((p) => p.postId)).toEqual(["3", "1"]);
          expect(data.viewsByPostDay).toEqual([{ day: "2026-10-21", posts: 2, views: 15 }]);
          expect(data.snapshots.at(-1)?.followers).toBe(500);
          expect(data.fetchedAt).toBe("2026-10-22T12:00:00.000Z");
        }).pipe(Effect.provide(layerService)),
      ),
  );

  it.effect(
    "the post strip measures a post against this account's mean, zero impressions too",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const row = (postId: string, impressions: number, likes: number, account = 1) =>
          sql`INSERT INTO post_analytics (post_id, day, impressions, profile_visits, link_clicks, follows, likes, replies, reposts, account_id)
            VALUES (${postId}, '2026-10-22', ${impressions}, 2, 0, 1, ${likes}, 0, 0, ${account})`;
        yield* row("1", 300, 30);
        yield* row("2", 0, 0);
        yield* row("3", 900, 9);
        // Another account's viral post must not move this account's average.
        yield* row("4", 1_000_000, 0, 2);

        const strip = yield* (yield* Analytics.Analytics).postStrip(["1", "2", "404"]);
        expect(strip).toEqual([
          { postId: "1", impressions: 300, er: 0.1, profileVisits: 2, follows: 1, vsAverage: 0.75 },
          { postId: "2", impressions: 0, er: 0, profileVisits: 2, follows: 1, vsAverage: 0 },
        ]);
      }).pipe(Effect.provide(layerService)),
  );
});

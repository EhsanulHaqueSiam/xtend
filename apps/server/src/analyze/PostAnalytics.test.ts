import { describe, expect, it } from "@effect/vitest";
import { type AccountPost, XApiError } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "../x/Treg.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";
import * as PostAnalytics from "./PostAnalytics.ts";

const fakeTreg = (answer: (call: Treg.TregCall) => Effect.Effect<unknown, XApiError>) =>
  Layer.succeed(Treg.Treg)({
    isCached: () => Effect.succeed(false),
    call: (input) =>
      Effect.map(answer(input), (body) => ({ status: 200, body, costUsd: 0, cached: false })),
  });

const layerTest = (treg: Layer.Layer<Treg.Treg>) =>
  PostAnalytics.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(AnalyticsStore.layer, SettingsStore.layer)),
    Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest, treg)),
  );

const metric = (metric_type: string, value: number) => ({ metric_type, value });

const seed = Effect.gen(function* () {
  yield* (yield* SettingsStore.SettingsStore).update({ handle: "siam" });
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const post = (postId: string, daysAgo: number): AccountPost => ({
    postId,
    url: "u",
    text: "t",
    createdAt: DateTime.formatIso(DateTime.makeUnsafe(now - daysAgo * 86_400_000)),
    kind: "text",
    views: 1,
    likes: 1,
    reposts: 0,
    replies: 0,
    quotes: 0,
    bookmarks: 0,
  });
  yield* (yield* AnalyticsStore.AnalyticsStore).replacePosts(
    "siam",
    [post("1", 2), post("2", 10), post("3", 45)],
    "2026-10-22T00:00:00.000Z",
  );
});

describe("PostAnalytics", () => {
  it.effect("asks for the last 30 days of own posts and stores the metrics it gets back", () =>
    Effect.gen(function* () {
      yield* seed;
      const analytics = yield* PostAnalytics.PostAnalytics;
      yield* analytics.refresh;
      const { lastRun, byPost } = yield* analytics.current;
      expect(lastRun?.error).toBeNull();
      expect(lastRun?.posts).toBe(2);
      expect(byPost.map((r) => [r.postId, r.impressions, r.follows, r.linkClicks])).toEqual([
        ["1", 1200, 3, 7],
        ["2", 50, 0, 0],
      ]);
      const strip = yield* analytics.current;
      expect(strip.byPost[0]?.likes).toBe(10);
    }).pipe(
      Effect.provide(
        layerTest(
          fakeTreg((call) => {
            expect(call.endpoint).toBe("x/2/tweets/analytics");
            expect(call.query?.ids).toBe("1,2");
            expect(call.expectedCostUsd).toBeCloseTo(0.01);
            return Effect.succeed({
              data: [
                {
                  id: "1",
                  measurement: {
                    metrics_total: [
                      metric("impressions", 1200),
                      metric("user_follows", 3),
                      metric("url_link_clicks", 7),
                      metric("likes", 10),
                    ],
                  },
                },
                { id: "2", measurement: { metrics_total: [metric("impressions", 50)] } },
              ],
            });
          }),
        ),
      ),
    ),
  );

  it.effect("records a failed run instead of failing, so the screen can say why", () =>
    Effect.gen(function* () {
      yield* seed;
      const analytics = yield* PostAnalytics.PostAnalytics;
      yield* analytics.refresh;
      const { lastRun, byPost } = yield* analytics.current;
      expect(lastRun?.error).toContain("provider");
      expect(byPost).toEqual([]);
    }).pipe(
      Effect.provide(
        layerTest(
          fakeTreg((call) =>
            Effect.fail(
              new XApiError({
                endpoint: call.endpoint,
                reason: "provider",
                status: 401,
                detail: "oauth refresh failed",
              }),
            ),
          ),
        ),
      ),
    ),
  );
});

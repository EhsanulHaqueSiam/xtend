import { describe, expect, it } from "@effect/vitest";
import type { XFollower } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as ScoreEngine from "./ScoreEngine.ts";
import * as Scores from "./Scores.ts";
import * as ScoreStore from "./ScoreStore.ts";

const follower = (userId: string, followers: number): XFollower => ({
  userId,
  handle: `f${userId}`,
  name: `F${userId}`,
  followers,
  following: 10,
  verified: false,
  bio: "builds things",
  createdAt: "2020-01-01T00:00:00.000Z",
});
const a = follower("1", 50_000);
const b = follower("2", 5_000);
const c = follower("3", 500);

// The follower list shifted between reads, so page 2 repeats b.
const overlapping: Record<string, { items: ReadonlyArray<XFollower>; nextCursor: string | null }> =
  {
    first: { items: [a, b], nextCursor: "c2" },
    c2: { items: [b, c], nextCursor: null },
  };

/** `followers` answers the page asked for; @ghost has no profile. */
const layerWith = (
  followers: (cursor: string | undefined) => {
    items: ReadonlyArray<XFollower>;
    nextCursor: string | null;
  },
) =>
  Scores.layer.pipe(
    Layer.provideMerge(ScoreStore.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        Sqlite.layerMemory,
        xClientStub({
          profile: (handle) =>
            Effect.succeed(
              handle === "ghost"
                ? null
                : {
                    userId: "10",
                    handle,
                    name: "Pieter",
                    bio: "",
                    followers: 3,
                    following: 1,
                    posts: 1,
                    verified: true,
                    avatarUrl: null,
                    createdAt: null,
                    location: null,
                    website: null,
                  },
            ),
          followers: (_handle, options) =>
            Effect.sync(() => ({ ...followers(options.cursor), fromCache: false })),
        }),
      ),
    ),
  );

const layerTest = layerWith((cursor) => overlapping[cursor ?? "first"]!);

describe("Scores", () => {
  it.effect("scores each follower once when follower pages overlap", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-22T12:00:00.000Z"));
      const scores = yield* Scores.Scores;
      const report = yield* scores.run("LevelsIO");

      const expected = ScoreEngine.score(
        [a, b, c],
        { followers: 3, following: 1 },
        yield* DateTime.now,
      );
      expect(report.latest?.sampled).toBe(3);
      expect(report.latest?.pages).toBe(2);
      expect(report.latest?.topFollowers.map((f) => f.userId)).toEqual(["1", "2", "3"]);
      expect(report.latest?.score).toBe(expected.score);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("reports who moved the score since the run before", () => {
    let followers: ReadonlyArray<XFollower> = [a, b];
    return Effect.gen(function* () {
      const scores = yield* Scores.Scores;
      yield* TestClock.setTime(Date.parse("2026-10-21T12:00:00.000Z"));
      const first = yield* scores.run("levelsio");
      expect(first.moved).toBeNull();

      followers = [{ ...b, followers: 500_000 }, c];
      yield* TestClock.setTime(Date.parse("2026-10-22T12:00:00.000Z"));
      const { moved, history } = yield* scores.run("levelsio");
      expect(moved?.sinceAt).toBe("2026-10-21T12:00:00.000Z");
      expect(moved?.joined.map((f) => f.userId)).toEqual(["3"]);
      expect(moved?.left.map((f) => f.userId)).toEqual(["1"]);
      expect(moved?.changed.map((f) => f.userId)).toEqual(["2"]);
      expect(history.map((h) => h.at)).toEqual([
        "2026-10-21T12:00:00.000Z",
        "2026-10-22T12:00:00.000Z",
      ]);
    }).pipe(Effect.provide(layerWith(() => ({ items: followers, nextCursor: null }))));
  });

  it.effect("scores an account nobody follows, and says once when a handle does not exist", () =>
    Effect.gen(function* () {
      const scores = yield* Scores.Scores;
      const report = yield* scores.run("levelsio");
      expect(report.latest).toMatchObject({ score: 0, tier: "Unknown", sampled: 0, botShare: 0 });

      const missing = yield* Effect.flip(scores.run("ghost"));
      expect(missing.message).toBe("Scores run failed: @ghost not found");
    }).pipe(Effect.provide(layerWith(() => ({ items: [], nextCursor: null })))),
  );
});

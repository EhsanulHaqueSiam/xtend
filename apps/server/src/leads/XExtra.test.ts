import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { xClientStub } from "../testing/xClientStub.ts";
import * as Treg from "../x/Treg.ts";
import * as XExtra from "./XExtra.ts";

const calls: Array<Treg.TregCall> = [];

// A Treg that answers the tikhub reposters shape and X's liking_users shape, and records every call.
const tregFake = Layer.succeed(Treg.Treg)({
  isCached: () => Effect.succeed(false),
  call: (input) =>
    Effect.sync(() => {
      calls.push(input);
      const body = input.endpoint.startsWith("tikhub")
        ? {
            data: {
              retweets: [
                { user_id: "11", screen_name: "Ada", name: "Ada L", followers_count: 120 },
                { user_id: "12", screen_name: "bob", description: "builds", followers_count: 5 },
                { name: "no handle" },
              ],
            },
          }
        : {
            data: [
              {
                id: "21",
                username: "Cara",
                name: "Cara",
                description: "likes things",
                public_metrics: { followers_count: 300 },
              },
            ],
          };
      return { status: 200, body, costUsd: input.expectedCostUsd ?? 0, cached: false };
    }),
});

const layerTest = XExtra.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      tregFake,
      xClientStub({
        me: () => Effect.succeed({ userId: "me1", handle: "siam", name: "Siam" }),
      }),
    ),
  ),
);

describe("XExtra", () => {
  it.effect("builds list candidates from reposters (scraper) and likers (X API)", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const extra = yield* XExtra.XExtra;
      const reposters = yield* extra.engagers("555", "repost", "test");
      expect(reposters.matches.map((c) => [c.handle, c.userId, c.followers, c.bio])).toEqual([
        ["ada", "11", 120, ""],
        ["bob", "12", 5, "builds"],
      ]);
      expect(reposters.costUsd).toBe(XExtra.engagersCostUsd("repost"));
      expect(calls[0]?.query).toEqual({ tweet_id: "555" });

      const likers = yield* extra.engagers("555", "like", "test");
      expect(likers.matches).toEqual([
        { handle: "cara", name: "Cara", userId: "21", followers: 300, bio: "likes things" },
      ]);
      expect(calls[1]?.endpoint).toBe("x/2/tweets/555/liking_users");
      expect(likers.costUsd).toBe(XExtra.engagersCostUsd("like"));
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("own-account writes use the connected user's id in the path", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const extra = yield* XExtra.XExtra;
      yield* extra.unrepost("555", "test");
      yield* extra.follow("21", "test");
      yield* extra.unfollow("21", "test");
      yield* extra.unlike("555", "test");
      expect(calls.map((c) => [c.method, c.endpoint])).toEqual([
        ["DELETE", "x/2/users/me1/retweets/555"],
        ["POST", "x/2/users/me1/following"],
        ["DELETE", "x/2/users/me1/following/21"],
        ["DELETE", "x/2/users/me1/likes/555"],
      ]);
      expect(calls[1]?.body).toEqual({ target_user_id: "21" });
    }).pipe(Effect.provide(layerTest)),
  );
});

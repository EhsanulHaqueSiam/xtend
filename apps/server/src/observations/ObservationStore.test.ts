import { describe, expect, it } from "@effect/vitest";
import type { ObservationBatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as ObservationStore from "./ObservationStore.ts";

const layerTest = ObservationStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const batch = (observedAt: string, likes: number): ObservationBatch => ({
  viewerHandle: "siam",
  source: "home",
  observedAt,
  posts: [
    {
      postId: "1",
      author: {
        userId: "10",
        handle: "levelsio",
        name: "Pieter",
        followers: 621000,
        verified: true,
      },
      text: "Shipped the thing.",
      createdAt: "2026-10-22T09:00:00.000Z",
      isReply: false,
      isRepost: false,
      isPromoted: false,
      hasMedia: false,
      hasLink: false,
      metrics: { views: 1000, likes, reposts: 2, replies: 1, quotes: 0, bookmarks: 3 },
    },
  ],
});

describe("ObservationStore", () => {
  it.effect("keeps one post row and appends metrics per observation", () =>
    Effect.gen(function* () {
      const store = yield* ObservationStore.ObservationStore;
      yield* store.record(batch("2026-10-22T10:00:00.000Z", 5));
      yield* store.record(batch("2026-10-22T11:00:00.000Z", 9));
      // Same observedAt twice is a replayed batch, not a new observation.
      yield* store.record(batch("2026-10-22T11:00:00.000Z", 9));

      const { posts } = yield* store.listRecent({});
      expect(posts).toHaveLength(1);
      expect(posts[0]?.metrics.likes).toBe(9);
      expect(posts[0]?.observations).toBe(2);
      expect(posts[0]?.firstSeenAt).toBe("2026-10-22T10:00:00.000Z");
      expect(posts[0]?.lastSeenAt).toBe("2026-10-22T11:00:00.000Z");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("adopts the session's viewer as the handle once, and never overrides one", () =>
    Effect.gen(function* () {
      const store = yield* ObservationStore.ObservationStore;
      const sql = yield* SqlClient.SqlClient;
      const handle = () =>
        sql<{ s: string | null; a: string | null }>`
          SELECT (SELECT handle FROM settings WHERE id = 1) AS s,
                 (SELECT handle FROM accounts WHERE id = 1) AS a
        `.pipe(Effect.map((rows) => rows[0]));
      yield* store.record({ ...batch("2026-10-22T10:00:00.000Z", 5), viewerHandle: "Siam" });
      expect(yield* handle()).toEqual({ s: "siam", a: "siam" });
      yield* store.record({ ...batch("2026-10-22T11:00:00.000Z", 6), viewerHandle: "other" });
      expect(yield* handle()).toEqual({ s: "siam", a: "siam" });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("filters by author handle, case-insensitively", () =>
    Effect.gen(function* () {
      const store = yield* ObservationStore.ObservationStore;
      yield* store.record(batch("2026-10-22T10:00:00.000Z", 5));
      const hit = yield* store.listRecent({ authorHandle: "LevelsIO" });
      const miss = yield* store.listRecent({ authorHandle: "nobody" });
      expect(hit.posts).toHaveLength(1);
      expect(hit.posts[0]?.author.handle).toBe("levelsio");
      expect(miss.posts).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps repost wrappers and ads out of the feed", () =>
    Effect.gen(function* () {
      const store = yield* ObservationStore.ObservationStore;
      const b = batch("2026-10-22T10:00:00.000Z", 5);
      const own = b.posts[0]!;
      yield* store.record({
        ...b,
        posts: [
          own,
          { ...own, postId: "2", isRepost: true },
          { ...own, postId: "3", isPromoted: true },
        ],
      });
      const { posts } = yield* store.listRecent({});
      expect(posts.map((p) => p.postId)).toEqual(["1"]);
    }).pipe(Effect.provide(layerTest)),
  );
});

import { describe, expect, it } from "@effect/vitest";
import type { AccountPost } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";

const layerTest = AnalyticsStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const post = (postId: string, views: number): AccountPost => ({
  postId,
  url: `https://x.com/siam/status/${postId}`,
  text: "hello",
  createdAt: `2026-10-2${postId}T09:00:00.000Z`,
  kind: "text",
  views,
  likes: 1,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0,
});

describe("AnalyticsStore", () => {
  it.effect("replaces the cached posts wholesale and reports when they were fetched", () =>
    Effect.gen(function* () {
      const store = yield* AnalyticsStore.AnalyticsStore;
      yield* store.replacePosts("siam", [post("1", 10), post("2", 20)], "2026-10-22T10:00:00.000Z");
      yield* store.replacePosts("siam", [post("2", 25)], "2026-10-22T11:00:00.000Z");
      const { posts, fetchedAt } = yield* store.listPosts("siam");
      expect(posts.map((p) => p.views)).toEqual([25]);
      expect(fetchedAt).toBe("2026-10-22T11:00:00.000Z");
      expect((yield* store.listPosts("other")).fetchedAt).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("caches analysis bodies by key", () =>
    Effect.gen(function* () {
      const store = yield* AnalyticsStore.AnalyticsStore;
      expect(yield* store.cacheGet("themes:1")).toBeNull();
      yield* store.cacheSet("themes:1", "[]", "2026-10-22T10:00:00.000Z");
      expect(yield* store.cacheGet("themes:1")).toBe("[]");
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("AnalyticsStore.listSnapshots", () => {
  it.effect("returns the newest year of daily snapshots, oldest first", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* AnalyticsStore.AnalyticsStore;
      const start = Date.parse("2025-01-01T00:00:00.000Z");
      for (let i = 0; i < 400; i++) {
        const day = DateTime.formatIsoDate(DateTime.makeUnsafe(start + i * 86_400_000));
        yield* sql`
          INSERT INTO profile_snapshots (handle, day, followers, following, posts)
          VALUES ('siam', ${day}, ${i}, 0, 0)`;
      }
      const snapshots = yield* store.listSnapshots("siam");
      expect(snapshots).toHaveLength(365);
      expect(snapshots.at(-1)).toMatchObject({ day: "2026-02-04", followers: 399 });
      expect(snapshots[0]?.followers).toBe(35);
    }).pipe(Effect.provide(layerTest)),
  );
});

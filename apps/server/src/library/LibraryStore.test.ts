import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as LibraryStore from "./LibraryStore.ts";

const layerTest = LibraryStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const post = (postId: string, views: number): XPost => ({
  postId,
  url: `https://x.com/levelsio/status/${postId}`,
  text: `Post ${postId}`,
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "10",
    handle: "levelsio",
    name: "Pieter",
    followers: 621000,
    verified: true,
    avatarUrl: null,
  },
  metrics: { views, likes: 5, reposts: 2, replies: 1, quotes: 0, bookmarks: 3 },
});

describe("LibraryStore", () => {
  it.effect("keeps one saved row per post across collections and the swipe file", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      const ideas = yield* store.collectionCreate("Ideas");
      const hooks = yield* store.collectionCreate("Hooks");
      yield* store.save({ post: post("1", 100), collectionId: ideas.id, note: "great hook" });
      const again = yield* store.save({ post: post("1", 100), collectionId: hooks.id });
      yield* store.save({ post: post("2", 50), collectionId: null });

      expect(again.note).toBe("great hook");
      expect(again.collectionIds).toEqual([ideas.id, hooks.id]);
      expect(yield* store.savedList({})).toHaveLength(2);
      expect(yield* store.savedList({ collectionId: hooks.id })).toHaveLength(1);
      expect(yield* store.savedList({ query: "great" })).toHaveLength(1);

      yield* store.collectionDelete(ideas.id);
      const cols = yield* store.collectionsList;
      expect(cols.map((c) => c.name)).toEqual(["Staff picks", "Hooks"]);
      // Deleting a collection keeps the post in the swipe file.
      expect((yield* store.getSavedPost("1"))?.collectionIds).toEqual([hooks.id]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("records picks once per keyword and mirrors them into Staff picks", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      yield* store.picksRecord({ day: "2026-10-22", keyword: "effect", posts: [post("1", 10)] });
      yield* store.picksRecord({
        day: "2026-10-22",
        keyword: "typescript",
        posts: [post("1", 10), post("2", 900)],
      });
      const picks = yield* store.picksForDay("2026-10-22");
      expect(picks.map((p) => p.post.postId)).toEqual(["2", "1"]);
      expect(picks[1]?.keyword).toBe("effect");
      expect(yield* store.pickFetchedKeywords("2026-10-22")).toEqual(["effect", "typescript"]);
      expect(yield* store.savedList({ collectionId: LibraryStore.STAFF_PICKS_ID })).toHaveLength(2);
    }).pipe(Effect.provide(layerTest)),
  );
});

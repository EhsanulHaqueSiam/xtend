import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as LibraryStore from "./LibraryStore.ts";

const layerTest = LibraryStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const post = (
  postId: string,
  views: number,
  extra: Partial<Pick<XPost, "createdAt" | "lang" | "hasMedia" | "hasLink" | "text">> & {
    readonly followers?: number;
  } = {},
): XPost => ({
  postId,
  url: `https://x.com/levelsio/status/${postId}`,
  text: extra.text ?? `Post ${postId}`,
  createdAt: extra.createdAt ?? "2026-10-22T09:00:00.000Z",
  lang: extra.lang ?? "en",
  isReply: false,
  isRepost: false,
  hasMedia: extra.hasMedia ?? false,
  hasLink: extra.hasLink ?? false,
  author: {
    userId: "10",
    handle: "levelsio",
    name: "Pieter",
    followers: extra.followers ?? 621000,
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
      expect((yield* store.savedList({})).total).toBe(2);
      expect((yield* store.savedList({ collectionId: hooks.id })).items).toHaveLength(1);
      expect((yield* store.savedList({ query: "great" })).items).toHaveLength(1);

      yield* store.collectionDelete(ideas.id);
      const cols = yield* store.collectionsList;
      expect(cols.map((c) => c.name)).toEqual(["Staff picks", "Hooks"]);
      // Deleting a collection keeps the post in the swipe file.
      expect((yield* store.getSavedPost("1"))?.collectionIds).toEqual([hooks.id]);
      // Deleting the posts, as a checked batch, takes them out of every collection they were in.
      const other = yield* store.getSavedPost("2");
      expect(yield* store.savedDelete([again.id, other!.id])).toBe(2);
      expect((yield* store.collectionsList).find((c) => c.id === hooks.id)?.posts).toBe(0);
      expect((yield* store.savedList({})).total).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("takes a post out of one collection, leaving it saved and in the others", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      const ideas = yield* store.collectionCreate("Ideas");
      const hooks = yield* store.collectionCreate("Hooks");
      yield* store.save({ post: post("1", 100), collectionId: ideas.id, note: "great hook" });
      const saved = yield* store.save({ post: post("1", 100), collectionId: hooks.id });

      yield* store.collectionRemovePost(ideas.id, saved.id);
      expect((yield* store.savedList({ collectionId: ideas.id })).items).toEqual([]);
      const kept = yield* store.getSavedPost("1");
      expect([kept?.note, kept?.collectionIds]).toEqual(["great hook", [hooks.id]]);
      expect((yield* store.collectionsList).map((c) => [c.name, c.posts])).toEqual([
        ["Staff picks", 0],
        ["Hooks", 1],
        ["Ideas", 0],
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("files several saved posts at once, counting only the new links", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* LibraryStore.LibraryStore;
      const hooks = yield* store.collectionCreate("Hooks");
      const a = yield* store.save({ post: post("1", 1), collectionId: hooks.id });
      const b = yield* store.save({ post: post("2", 1), collectionId: null });
      const c = yield* store.save({ post: post("3", 1), collectionId: null });

      expect(yield* store.collectionAddPosts(hooks.id, [a.id, b.id, c.id])).toBe(2);
      expect((yield* store.getSavedPost("2"))?.collectionIds).toEqual([hooks.id]);
      // Staff picks is read-only, and another account's collection links nothing.
      const staff = (yield* store.collectionsList).find((x) => x.builtIn)!;
      expect(yield* store.collectionAddPosts(staff.id, [a.id])).toBe(0);
      yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
      expect(yield* store.collectionAddPosts(hooks.id, [a.id])).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "searches saved posts by their text, author and note, with % and _ taken literally",
    () =>
      Effect.gen(function* () {
        const store = yield* LibraryStore.LibraryStore;
        const hooks = yield* store.collectionCreate("Hooks");
        yield* store.save({
          post: post("1", 1, { text: "Grew 100% in a week" }),
          collectionId: null,
        });
        yield* store.save({
          post: post("2", 1, { text: "Grew 1000 users" }),
          collectionId: hooks.id,
        });
        yield* store.save({ post: post("3", 1, { text: "snake_case wins" }), collectionId: null });
        yield* store.save({ post: post("4", 1, { text: "snakeXcase loses" }), collectionId: null });
        yield* store.save({ post: post("5", 1), collectionId: hooks.id, note: "Great hook" });
        const ids = (input: Parameters<typeof store.savedList>[0]) =>
          Effect.map(store.savedList(input), (page) => page.items.map((r) => r.post.postId));

        expect(yield* ids({ query: "100%" })).toEqual(["1"]);
        expect(yield* ids({ query: "snake_case" })).toEqual(["3"]);
        expect(yield* ids({ query: "great HOOK" })).toEqual(["5"]);
        expect(yield* ids({ query: "levelsio" })).toHaveLength(5);
        // The author as X writes it.
        expect(yield* ids({ query: "@levelsio" })).toHaveLength(5);
        // The stored JSON's keys and the post URL are not what the user searches.
        expect(yield* ids({ query: "author" })).toEqual([]);
        expect(yield* ids({ query: "x.com" })).toEqual([]);
        // A collection and a query narrow together.
        expect(yield* ids({ collectionId: hooks.id, query: "grew" })).toEqual(["2"]);
        expect(yield* ids({ query: "  " })).toHaveLength(5);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps each account's saved posts, collections, archive and Staff picks apart", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* LibraryStore.LibraryStore;
      const asAccount = (id: number) =>
        sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`;

      const ideas = yield* store.collectionCreate("Ideas");
      const mine = yield* store.save({ post: post("1", 10), collectionId: ideas.id, note: "mine" });
      yield* store.upsertPosts([post("1", 100)]);

      yield* asAccount(2);
      // A collection id from the other account, as a stale list after a switch would send.
      const theirs = yield* store.save({ post: post("1", 10), collectionId: ideas.id });
      expect(theirs.id).not.toBe(mine.id);
      expect(theirs.note).toBe("");
      expect(theirs.collectionIds).toEqual([]);
      expect((yield* store.savedList({})).items.map((s) => s.id)).toEqual([theirs.id]);
      expect(yield* store.savedIds).toEqual(["1"]);
      expect(yield* store.collectionsList).toEqual([]);
      expect(yield* store.browse({})).toEqual({ items: [], total: 0 });
      // Ids from the other account change nothing here.
      yield* store.savedSetNote(mine.id, "hijacked");
      expect(yield* store.savedDelete([mine.id])).toBe(0);
      yield* store.collectionRename(ideas.id, "Hijacked");
      yield* store.collectionRemovePost(ideas.id, mine.id);
      yield* store.collectionDelete(ideas.id);
      yield* store.upsertPosts([post("1", 5)]);
      expect((yield* store.libraryPost("1"))?.post.metrics.views).toBe(5);
      yield* store.picksRecord({ day: "2026-10-22", keyword: "effect", posts: [post("2", 900)] });
      const staff = yield* store.collectionsList;
      expect(staff.map((c) => [c.name, c.builtIn, c.posts])).toEqual([["Staff picks", true, 1]]);

      // A link the 014-era picks made from this account's post into account 1's Staff picks.
      yield* sql`INSERT INTO collection_posts (collection_id, saved_id) VALUES (1, ${theirs.id})`;

      yield* asAccount(1);
      // Account 2's Staff picks saved post 2 there, not here.
      expect(yield* store.savedIds).toEqual(["1"]);
      expect((yield* store.getSavedPost("1"))?.note).toBe("mine");
      expect(yield* store.getSavedPost("2")).toBeNull();
      expect((yield* store.libraryPost("1"))?.post.metrics.views).toBe(100);
      const cols = yield* store.collectionsList;
      expect(cols.map((c) => [c.name, c.posts])).toEqual([
        ["Staff picks", 0],
        ["Ideas", 1],
      ]);
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
      const staff = (yield* store.collectionsList).find((c) => c.builtIn);
      expect(staff?.posts).toBe(2);
      expect((yield* store.savedList({ collectionId: staff!.id })).items).toHaveLength(2);
      // Read-only: a rename, delete or removal leaves it as it is.
      yield* store.collectionRename(staff!.id, "Mine now");
      yield* store.collectionDelete(staff!.id);
      yield* store.collectionRemovePost(
        staff!.id,
        (yield* store.savedList({ collectionId: staff!.id })).items[0]!.id,
      );
      expect((yield* store.collectionsList).map((c) => [c.name, c.posts])).toEqual([
        ["Staff picks", 2],
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "archives every post it sees and filters by views, format, year, author band and language",
    () =>
      Effect.gen(function* () {
        const store = yield* LibraryStore.LibraryStore;
        yield* store.upsertPosts([
          post("1", 50_000, { hasMedia: true, followers: 2_000_000 }),
          post("2", 900, { hasLink: true, createdAt: "2025-03-01T00:00:00.000Z", lang: "de" }),
          post("3", 10, { followers: 500 }),
        ]);
        // Seen again with fresh metrics: one row, metrics refreshed, label kept.
        yield* store.setPatterns([{ postId: "3", format: "thread", hookPattern: "list" }]);
        yield* store.upsertPosts([post("3", 20, { followers: 500 })]);

        const ids = (filters: Parameters<typeof store.browse>[0]) =>
          Effect.map(store.browse(filters), (page) => page.items.map((r) => r.post.postId));
        expect(yield* ids({})).toEqual(["1", "2", "3"]);
        expect(yield* ids({ minViews: 500 })).toEqual(["1", "2"]);
        expect(yield* ids({ format: "media" })).toEqual(["1"]);
        expect(yield* ids({ format: "thread" })).toEqual(["3"]);
        expect(yield* ids({ year: 2025 })).toEqual(["2"]);
        expect(yield* ids({ authorBand: "1M+" })).toEqual(["1"]);
        expect(yield* ids({ authorBand: "under 10k" })).toEqual(["3"]);
        expect(yield* ids({ lang: "de" })).toEqual(["2"]);
        expect(yield* ids({ hookPattern: "list" })).toEqual(["3"]);
        expect(yield* ids({ query: " post 2 " })).toEqual(["2"]);
        expect(yield* ids({ query: "@levelsio", minViews: 500 })).toEqual(["1", "2"]);
        expect(yield* ids({ query: "100%" })).toEqual([]);
        expect((yield* store.libraryPost("3"))?.post.metrics.views).toBe(20);
        expect(yield* store.undetectedCount).toBe(2);
        expect((yield* store.undetected(1)).map((r) => r.post.postId)).toEqual(["1"]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("sorts the whole archive by newest or engagement before the 200-row cap", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      yield* store.upsertPosts(
        Array.from({ length: 200 }, (_, i) =>
          post(String(100 + i), 10_000 + i, { createdAt: "2026-01-01T00:00:00.000Z" }),
        ),
      );
      // The fewest views, so outside the 200 most viewed, yet the newest and the best ER.
      yield* store.upsertPosts([post("1", 20, { createdAt: "2026-10-28T00:00:00.000Z" })]);

      const ids = (filters: Parameters<typeof store.browse>[0]) =>
        Effect.map(store.browse(filters), (page) => page.items.map((r) => r.post.postId));
      expect(yield* ids({})).not.toContain("1");
      expect((yield* ids({ sort: "newest" }))[0]).toBe("1");
      expect((yield* ids({ sort: "er" }))[0]).toBe("1");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("pages saved posts and the archive with the true total, and lists every saved id", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      for (let i = 1; i <= 201; i++)
        yield* store.save({ post: post(String(i), 1), collectionId: null });
      const first = yield* store.savedList({});
      expect([first.items.length, first.total]).toEqual([200, 201]);
      expect(first.items.map((s) => s.post.postId)).not.toContain("1");
      const next = yield* store.savedList({ offset: 200 });
      expect([next.items.map((s) => s.post.postId), next.total]).toEqual([["1"], 201]);
      expect((yield* store.savedList({ query: "Post 20", offset: 0 })).total).toBe(3);

      yield* store.upsertPosts(Array.from({ length: 201 }, (_, i) => post(String(i), i)));
      const archive = yield* store.browse({ offset: 200 });
      expect([archive.items.map((r) => r.post.postId), archive.total]).toEqual([["0"], 201]);
      expect((yield* store.browse({ minViews: 101 })).total).toBe(100);
      const ids = yield* store.savedIds;
      expect(ids).toHaveLength(201);
      expect(ids).toContain("1");
    }).pipe(Effect.provide(layerTest)),
  );
});

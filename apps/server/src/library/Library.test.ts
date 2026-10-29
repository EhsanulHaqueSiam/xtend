import { describe, expect, it } from "@effect/vitest";
import { XApiError, type XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Assist from "../ai/Assist.ts";
import * as DraftStore from "../compose/DraftStore.ts";
import * as Events from "../events/Events.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Pool from "../pool/Pool.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import type * as XClient from "../x/XClient.ts";
import * as Library from "./Library.ts";
import * as LibraryStore from "./LibraryStore.ts";
import staffPicksJson from "./staffPicks.json" with { type: "json" };

const post = (postId: string, text: string): XPost => ({
  postId,
  url: `https://x.com/naval/status/${postId}`,
  text,
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "1",
    handle: "naval",
    name: "Naval",
    followers: 1,
    verified: true,
    avatarUrl: null,
  },
  metrics: { views: 100, likes: 5, reposts: 2, replies: 1, quotes: 0, bookmarks: 3 },
});

/** Records every request and answers from a per-task table, as a fake model would. */
const requests: Array<Assist.AssistRequest<unknown>> = [];
const answers: Record<string, unknown> = {
  "library.detectPatterns": {
    labels: [
      { postId: "1", format: "text", hookPattern: "contrarian claim" },
      { postId: "2", format: "thread", hookPattern: "list" },
      { postId: "ghost", format: "text", hookPattern: "other" },
    ],
  },
  "library.pickWhy": { why: "A blunt hook.\nOne line, no media." },
  "library.pickDraft": {
    options: [{ blocks: ["Ship weekly."] }, { blocks: ["Ship daily.", "Here is why."] }],
  },
  "library.writeInFormat": { drafts: ["5 things a cofounder costs you", "a", "b", "c"] },
  "library.generateReady": {
    posts: [
      { text: "one", basis: "#effect", voiceMatch: 80 },
      { text: "two", basis: "naval", voiceMatch: 65 },
      { text: "three", basis: "#effect", voiceMatch: 90 },
      { text: "four", basis: "extra", voiceMatch: 10 },
    ],
  },
};
const assistFake = Layer.succeed(Assist.Assist)({
  generate: <A>(request: Assist.AssistRequest<A>) => {
    requests.push(request);
    return Effect.succeed(answers[request.task] as A);
  },
});

const layerWith = (searchPosts: XClient.XClient["Service"]["searchPosts"]) =>
  Library.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(LibraryStore.layer, DraftStore.layer, ObservationStore.layer, Pool.layerNoop),
    ),
    Layer.provideMerge(Layer.mergeAll(SettingsStore.layer, assistFake, Events.layer)),
    Layer.provideMerge(
      Layer.mergeAll(
        Sqlite.layerMemory,
        TokenCipher.layerTest,
        xClientStub({
          searchPosts,
          trending: () =>
            Effect.succeed([
              { name: "#effect", context: null, postCount: 10 },
              { name: "#vite", context: null, postCount: 5 },
            ]),
        }),
      ),
    ),
  );

const layerTest = layerWith(() =>
  Effect.succeed({ items: [post("9", "Ship daily.")], nextCursor: null, fromCache: false }),
);

/** A search that records what it was asked and stops once `budget` searches have been paid. */
const meteredSearch = (answer: (query: string) => ReadonlyArray<XPost>) => {
  const state = { budget: Number.POSITIVE_INFINITY, queries: [] as Array<string> };
  const searchPosts: XClient.XClient["Service"]["searchPosts"] = (query, options) =>
    Effect.suspend(() => {
      if (state.budget <= 0)
        return Effect.fail(
          new XApiError({
            endpoint: "anyapi.x.search.posts",
            reason: "budget",
            status: null,
            detail: "monthly budget reached",
          }),
        );
      state.budget -= 1;
      state.queries.push(`${options.mode} ${query}`);
      return Effect.succeed({ items: answer(query), nextCursor: null, fromCache: false });
    });
  return { state, layer: layerWith(searchPosts) };
};

describe("Library", () => {
  it.effect("labels a batch of unlabelled archive posts with one model call", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const store = yield* LibraryStore.LibraryStore;
      const library = yield* Library.Library;
      yield* store.upsertPosts([
        post("1", "Nobody needs a cofounder."),
        post("2", "1/ Ten lessons"),
      ]);

      expect(yield* library.detectPatterns).toEqual({ detected: 2, remaining: 0 });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.task).toBe("library.detectPatterns");
      expect(requests[0]?.input).toEqual([
        { postId: "1", format: "text", text: "Nobody needs a cofounder." },
        { postId: "2", format: "text", text: "1/ Ten lessons" },
      ]);
      const labelled = yield* store.browse({ hookPattern: "list" });
      expect(labelled.map((p) => [p.post.postId, p.format])).toEqual([["2", "thread"]]);
      // Nothing left: no second call.
      expect(yield* library.detectPatterns).toEqual({ detected: 0, remaining: 0 });
      expect(requests).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("counts only the posts the model labelled, so a skipped one stays to do", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      const library = yield* Library.Library;
      // The fake labels 1, 2 and an id it made up; 3 is skipped.
      yield* store.upsertPosts([post("1", "a"), post("2", "b"), post("3", "c")]);

      expect(yield* library.detectPatterns).toEqual({ detected: 2, remaining: 1 });
      expect((yield* store.undetected(10)).map((p) => p.post.postId)).toEqual(["3"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps the morning's picks as the picks of the day after UTC midnight", () =>
    Effect.gen(function* () {
      const library = yield* Library.Library;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ keywords: ["effect"], timeZone: "America/Los_Angeles" });
      // 08:00 on Oct 22 in Los Angeles, when the daily job runs.
      yield* TestClock.setTime(Date.parse("2026-10-22T15:00:00.000Z"));
      yield* library.picksFetch;

      // 19:00 the same local day; UTC is already Oct 23.
      yield* TestClock.setTime(Date.parse("2026-10-23T02:00:00.000Z"));
      const state = yield* library.picksGet;
      expect(state.day).toBe("2026-10-22");
      expect(state.pending).toEqual([]);
      expect(state.picks.map((p) => p.post.postId)).toEqual(["9"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps the format a post's own flags give unless the model says thread", () =>
    Effect.gen(function* () {
      const store = yield* LibraryStore.LibraryStore;
      const library = yield* Library.Library;
      // The fake calls 1 text and 2 a thread; both have media.
      yield* store.upsertPosts([
        { ...post("1", "Nobody needs a cofounder."), hasMedia: true },
        { ...post("2", "1/ Ten lessons"), hasMedia: true },
      ]);
      yield* library.detectPatterns;

      const formats = (yield* store.browse({})).map((p) => [p.post.postId, p.format]);
      expect(formats.sort()).toEqual([
        ["1", "media"],
        ["2", "thread"],
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "records each keyword's picks as it pays, so a budget stop resumes where it left off",
    () => {
      const search = meteredSearch((query) => [
        post(query.startsWith("effect") ? "1" : "2", query),
      ]);
      return Effect.gen(function* () {
        const library = yield* Library.Library;
        const settings = yield* SettingsStore.SettingsStore;
        yield* settings.update({ keywords: ["effect", "vite"] });
        search.state.budget = 1;

        const stopped = yield* Effect.flip(library.picksFetch);
        expect(stopped._tag === "XApiError" && stopped.reason).toBe("budget");
        const state = yield* library.picksGet;
        expect(state.pending).toEqual(["vite"]);
        expect(state.picks.map((p) => p.post.postId)).toEqual(["1"]);

        search.state.budget = Number.POSITIVE_INFINITY;
        yield* library.picksFetch;
        expect(search.state.queries.map((q) => q.split(" ").slice(0, 3).join(" "))).toEqual([
          "top effect min_faves:200",
          "top vite min_faves:200",
        ]);
        expect((yield* library.picksGet).pending).toEqual([]);
      }).pipe(Effect.provide(search.layer));
    },
  );

  it.effect("fetches Staff picks text with one top search per author still missing", () => {
    const picksOf = (handle: string) =>
      staffPicksJson.filter((s) => s.handle === handle).map((s) => post(s.postId, s.topic));
    const search = meteredSearch((query) => picksOf(query.replace("from:", "")));
    const authors = [...new Set(staffPicksJson.map((s) => s.handle))];
    const missingAuthors = (picks: ReadonlyArray<{ handle: string; post: XPost | null }>) => [
      ...new Set(picks.filter((p) => p.post === null).map((p) => p.handle)),
    ];
    return Effect.gen(function* () {
      const library = yield* Library.Library;
      // The button prices one search per author it lists as missing.
      expect(missingAuthors(yield* library.staffPicks)).toEqual(authors);
      search.state.budget = 3;

      const stopped = yield* Effect.flip(library.staffPicksFetch);
      expect(stopped._tag === "XApiError" && stopped.reason).toBe("budget");
      expect(search.state.queries).toEqual(authors.slice(0, 3).map((h) => `top from:${h}`));
      // What the paid searches returned is kept; the next fetch asks only for the rest.
      expect(missingAuthors(yield* library.staffPicks)).toEqual(authors.slice(3));

      search.state.budget = Number.POSITIVE_INFINITY;
      search.state.queries.length = 0;
      const done = yield* library.staffPicksFetch;
      expect(search.state.queries).toEqual(authors.slice(3).map((h) => `top from:${h}`));
      expect(missingAuthors(done)).toEqual([]);
    }).pipe(Effect.provide(search.layer));
  });

  it.effect("caches why a pick worked, and drafts options in the picked tone every time", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const store = yield* LibraryStore.LibraryStore;
      const library = yield* Library.Library;
      yield* store.picksRecord({
        day: "2026-10-22",
        keyword: "effect",
        posts: [post("5", "Ship")],
      });

      for (let i = 0; i < 2; i++) {
        expect(yield* library.pickWhy("5")).toBe("A blunt hook.\nOne line, no media.");
        expect(yield* library.pickDraft("5", "short")).toEqual([
          ["Ship weekly."],
          ["Ship daily.", "Here is why."],
        ]);
      }
      expect(requests.map((r) => [r.task, r.tone])).toEqual([
        ["library.pickWhy", undefined],
        ["library.pickDraft", "short"],
        ["library.pickDraft", "short"],
      ]);
      expect((yield* Effect.flip(library.pickWhy("404"))).detail).toBe("Pick not found.");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("writes three options in an archive post's format and hook, filing none", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const store = yield* LibraryStore.LibraryStore;
      const library = yield* Library.Library;
      const drafts = yield* DraftStore.DraftStore;
      yield* store.upsertPosts([post("7", "3 things I learned")]);
      yield* store.setPatterns([{ postId: "7", format: "text", hookPattern: "number hook" }]);

      const written = yield* library.writeInFormat("7");
      expect(written).toEqual(["5 things a cofounder costs you", "a", "b"]);
      expect(requests[0]?.input).toEqual({
        example: "3 things I learned",
        format: "text",
        hookPattern: "number hook",
      });
      // The user keeps one through suggestedDraftSave; nothing lands in Compose on its own.
      expect(yield* drafts.byStatus("suggested")).toEqual([]);
      expect((yield* Effect.flip(library.writeInFormat("404"))).detail).toBe(
        "Post not in the archive.",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("falls back to country trends for ready posts before any topic exists", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const library = yield* Library.Library;
      const drafts = yield* DraftStore.DraftStore;
      const ready = yield* library.generateReady("UnitedStates");

      expect(ready.map((r) => r.text)).toEqual(["one", "two", "three"]);
      const input = requests[0]?.input as { topics: ReadonlyArray<{ topic: string }> };
      expect(input.topics.map((t) => t.topic)).toEqual(["#effect", "#vite"]);
      const suggested = yield* drafts.byStatus("suggested");
      expect(suggested.map((d) => d.source).sort()).toEqual([
        "ready-to-post: #effect (voice 80)",
        "ready-to-post: #effect (voice 90)",
        "ready-to-post: naval (voice 65)",
      ]);
      expect(suggested.map((d) => d.id).sort()).toEqual(ready.map((r) => r.draftId).sort());
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "writes ready posts from for-you topics and the user's best posts, not country trends",
    () =>
      Effect.gen(function* () {
        requests.length = 0;
        yield* TestClock.setTime(Date.parse("2026-10-29T12:00:00.000Z"));
        const settings = yield* SettingsStore.SettingsStore;
        yield* settings.update({ handle: "me", keywords: ["effect"] });
        const observed = (postId: string, handle: string, text: string, likes = 0) => ({
          postId,
          author: { userId: `u-${handle}`, handle, name: handle, followers: 100, verified: false },
          text,
          createdAt: "2026-10-29T09:00:00.000Z",
          isReply: false,
          isRepost: false,
          isPromoted: false,
          hasMedia: false,
          hasLink: false,
          metrics: { views: 10, likes, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
        });
        yield* (yield* ObservationStore.ObservationStore).record({
          viewerHandle: "me",
          source: "home",
          observedAt: "2026-10-29T11:00:00.000Z",
          posts: [
            observed("101", "ann", "Effect schema just shipped"),
            observed("102", "bob", "Trying effect schema today"),
            observed("103", "me", "Typed errors beat exceptions", 40),
          ],
        });
        const library = yield* Library.Library;
        const topics = yield* library.forYou;
        expect(topics[0]).toMatchObject({ term: "effect schema", source: "feed" });
        expect(topics[0]?.reason).toBe("2 accounts in your feed today · in your keywords");

        yield* library.generateReady("UnitedStates");
        const input = requests[0]?.input as {
          topics: ReadonlyArray<{ topic: string }>;
          yourBestPosts: ReadonlyArray<string>;
        };
        expect(input.topics[0]?.topic).toBe("effect schema");
        expect(input.yourBestPosts).toEqual(["Typed errors beat exceptions"]);
      }).pipe(Effect.provide(layerTest)),
  );
});

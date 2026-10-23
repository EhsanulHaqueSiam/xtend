import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Assist from "../ai/Assist.ts";
import * as DraftStore from "../compose/DraftStore.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as Library from "./Library.ts";
import * as LibraryStore from "./LibraryStore.ts";

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

const layerTest = Library.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(LibraryStore.layer, DraftStore.layer)),
  Layer.provideMerge(Layer.mergeAll(SettingsStore.layer, assistFake, Events.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        trending: () =>
          Effect.succeed([
            { name: "#effect", context: null, postCount: 10 },
            { name: "#vite", context: null, postCount: 5 },
          ]),
      }),
    ),
  ),
);

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

  it.effect("files three ready-to-post drafts from trends and picks as suggested drafts", () =>
    Effect.gen(function* () {
      requests.length = 0;
      const library = yield* Library.Library;
      const drafts = yield* DraftStore.DraftStore;
      const ready = yield* library.generateReady("UnitedStates");

      expect(ready.map((r) => r.text)).toEqual(["one", "two", "three"]);
      const input = requests[0]?.input as { trends: ReadonlyArray<string> };
      expect(input.trends).toEqual(["#effect", "#vite"]);
      const suggested = yield* drafts.byStatus("suggested");
      expect(suggested.map((d) => d.source).sort()).toEqual([
        "ready-to-post: #effect (voice 80)",
        "ready-to-post: #effect (voice 90)",
        "ready-to-post: naval (voice 65)",
      ]);
      expect(suggested.map((d) => d.id).sort()).toEqual(ready.map((r) => r.draftId).sort());
    }).pipe(Effect.provide(layerTest)),
  );
});

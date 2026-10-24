import { describe, expect, it } from "@effect/vitest";
import { XApiError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "../x/Treg.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Articles from "./Articles.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Media from "./Media.ts";

// Records every treg call; answers like X's article endpoints and Replicate's prediction flow.
// With `failPublish` X refuses the publish step; `coverStatus` is what the image CDN answers.
const tregCalls: Array<Treg.TregCall> = [];
const stub = { failPublish: false, coverStatus: 200 };
const tregStub = Layer.succeed(Treg.Treg)({
  isCached: () => Effect.succeed(false),
  call: (input) =>
    Effect.suspend(() => {
      tregCalls.push(input);
      if (stub.failPublish && input.endpoint.endsWith("/publish"))
        return Effect.fail(
          new XApiError({
            endpoint: input.endpoint,
            reason: "provider",
            status: 503,
            detail: "Over capacity",
          }),
        );
      const body = input.endpoint.endsWith("/draft")
        ? { data: { id: "art-1" } }
        : input.endpoint.endsWith("/publish")
          ? { data: { id: "post-9" } }
          : input.endpoint === "replicate.predictions.get"
            ? { status: "succeeded", output: ["https://cdn.example/cover.webp"] }
            : { id: "pred-1", status: "starting" };
      return Effect.succeed({
        status: 200,
        body,
        costUsd: input.expectedCostUsd ?? 0,
        cached: false,
      });
    }),
});

const httpStub = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(
        request,
        new Response(new Uint8Array([1, 2, 3]), { status: stub.coverStatus }),
      ),
    ),
  ),
);

const reset = () => {
  tregCalls.length = 0;
  stub.failPublish = false;
  stub.coverStatus = 200;
};

const tmp = `/tmp/xtend-articles-test-${process.pid}`;
const layerTest = Articles.layer.pipe(
  Layer.provideMerge(Media.layer),
  Layer.provideMerge(DraftStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      Events.layer,
      tregStub,
      httpStub,
      ServerConfig.layer({
        version: "test",
        port: 0,
        host: "127.0.0.1",
        baseDir: tmp,
        dbPath: ":memory:",
        staticDir: undefined,
        devUrl: undefined,
        supervisor: "none",
      }),
    ),
  ),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
  Layer.provideMerge(NodeServices.layer),
);

describe("Articles", () => {
  it.effect("creates X's draft once: a retry after a failed publish reuses it", () =>
    Effect.gen(function* () {
      reset();
      stub.failPublish = true;
      const drafts = yield* DraftStore.DraftStore;
      const articles = yield* Articles.Articles;
      const d = yield* drafts.create({ kind: "article", title: "T", body: "# hello" });
      expect((yield* Effect.result(articles.publish(d, "test")))._tag).toBe("Failure");
      expect(tregCalls[0]?.body).toEqual({ title: "T", content: "# hello" });

      stub.failPublish = false;
      const retried = yield* drafts.get(d.id);
      expect(retried.articleId).toBe("art-1");
      expect(yield* articles.publish(retried, "test")).toEqual({
        articleId: "art-1",
        postId: "post-9",
      });
      expect(tregCalls.map((c) => c.endpoint)).toEqual([
        "x/2/articles/draft",
        "x/2/articles/art-1/publish",
        "x/2/articles/art-1/publish",
      ]);
      expect(tregCalls.every((c) => c.expectedCostUsd === 0.005)).toBe(true);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("generates a cover, downloads it and attaches it to the article", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const articles = yield* Articles.Articles;
      const d = yield* drafts.create({ kind: "article", title: "T", body: "b" });
      const withCover = yield* articles.generateCover(d.id, "a red kite", "test");
      expect(withCover.media).toHaveLength(1);
      expect(withCover.media[0]?.alt).toBe("a red kite");
      expect(withCover.media[0]?.path.startsWith(`${tmp}/media/${d.id}/`)).toBe(true);
      expect(tregCalls[0]?.endpoint).toBe(Articles.COVER.model);
      expect(tregCalls[0]?.expectedCostUsd).toBe(Articles.COVER.usd);
      expect(tregCalls[1]?.query).toEqual({ id: "pred-1" });
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("an expired image link is not stored as the cover", () =>
    Effect.gen(function* () {
      reset();
      stub.coverStatus = 403;
      const drafts = yield* DraftStore.DraftStore;
      const articles = yield* Articles.Articles;
      const d = yield* drafts.create({ kind: "article", title: "T", body: "b" });
      expect((yield* Effect.result(articles.generateCover(d.id, "kite", "test")))._tag).toBe(
        "Failure",
      );
      expect((yield* drafts.get(d.id)).media).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a cover it could not attach before paying for it", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const articles = yield* Articles.Articles;
      const d = yield* drafts.create({ kind: "article", title: "T", body: "b" });
      yield* drafts.setOutcome(d.id, { status: "posted" });
      const refused = yield* Effect.flip(articles.generateCover(d.id, "kite", "test"));
      expect(refused.detail).toContain("posted");
      expect(tregCalls).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );
});

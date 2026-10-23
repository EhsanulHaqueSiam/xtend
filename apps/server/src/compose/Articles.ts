import { ComposeError, type Draft } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";

import * as Treg from "../x/Treg.ts";
import * as Media from "./Media.ts";

/** X Articles through treg: $0.005 per request on X's content row. Neither endpoint is verified against the live API. */
const ARTICLE = {
  createDraft: "x/2/articles/draft",
  publish: (articleId: string) => `x/2/articles/${articleId}/publish`,
  usd: 0.005,
} as const;

/** Cheapest image model in treg's catalog with a verified success rate; one webp per call. */
export const COVER = {
  model: "replicate.image-gen.flux-schnell",
  poll: "replicate.predictions.get",
  usd: 0.003,
} as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export class Articles extends Context.Service<
  Articles,
  {
    /** Creates X's draft (once; retries reuse `draft.articleId`) and publishes it. Returns the article's post id. */
    readonly publish: (
      draft: Draft,
      purpose: string,
    ) => Effect.Effect<{ readonly articleId: string; readonly postId: string }, ComposeError>;
    /** Paid: one image from COVER.model, stored as the article's cover (media on block 0). */
    readonly generateCover: (
      draft: Draft,
      prompt: string,
      purpose: string,
    ) => Effect.Effect<Draft, ComposeError>;
    readonly quote: {
      readonly articleUsd: number;
      readonly coverUsd: number;
      readonly coverModel: string;
    };
  }
>()("xtend/compose/Articles") {}

const make = Effect.gen(function* () {
  const treg = yield* Treg.Treg;
  const media = yield* Media.Media;
  const http = yield* HttpClient.HttpClient;
  const fail = (operation: string) => (cause: { readonly message: string }) =>
    cause instanceof ComposeError
      ? cause
      : new ComposeError({ operation, detail: cause.message.slice(0, 300) });

  const publish = Effect.fn("Articles.publish")(
    function* (draft: Draft, purpose: string) {
      const articleId =
        draft.articleId ??
        str(
          obj(
            obj(
              (yield* treg.call({
                endpoint: ARTICLE.createDraft,
                method: "POST",
                // shortcut: X's article body shape is undocumented in treg's catalog; title + markdown content, revisit on the first real call.
                body: { title: draft.title, content: draft.body },
                purpose,
                expectedCostUsd: ARTICLE.usd,
              })).body,
            ).data,
          ).id,
        );
      if (articleId === "")
        return yield* new ComposeError({
          operation: "articlePublish",
          detail: "X returned no article id for the draft",
        });
      const published = yield* treg.call({
        endpoint: ARTICLE.publish(articleId),
        method: "POST",
        body: {},
        purpose,
        expectedCostUsd: ARTICLE.usd,
      });
      const data = obj(obj(published.body).data);
      const postId = str(data.tweet_id) || str(data.post_id) || str(data.id) || articleId;
      return { articleId, postId };
    },
    Effect.mapError(fail("articlePublish")),
  );

  const generateCover = Effect.fn("Articles.generateCover")(
    function* (draft: Draft, prompt: string, purpose: string) {
      const started = yield* treg.call({
        endpoint: COVER.model,
        method: "POST",
        body: { input: { prompt, num_outputs: 1, aspect_ratio: "16:9", output_format: "webp" } },
        purpose,
        expectedCostUsd: COVER.usd,
      });
      const taskId = str(obj(started.body).id);
      // Replicate answers at once; the image is ready a few seconds later.
      let finished: Json | null = null;
      for (let i = 0; i < 45 && finished === null; i++) {
        yield* Effect.sleep(Duration.seconds(2));
        const r = yield* treg.call({
          endpoint: COVER.poll,
          query: { id: taskId },
          purpose,
          expectedCostUsd: 0,
        });
        const status = str(obj(r.body).status);
        if (status === "succeeded") finished = obj(r.body);
        else if (status === "failed" || status === "canceled")
          return yield* new ComposeError({
            operation: "generateCover",
            detail: `cover generation ${status}: ${str(obj(r.body).error)}`,
          });
      }
      if (finished === null)
        return yield* new ComposeError({
          operation: "generateCover",
          detail: "cover generation timed out",
        });
      const output = finished.output;
      const url = Array.isArray(output) ? str(output[0]) : str(output);
      if (url === "")
        return yield* new ComposeError({
          operation: "generateCover",
          detail: "no image in the result",
        });
      // A public, expiring CDN link with no credential; the only download outside x/Treg.ts.
      const bytes = yield* http.get(url).pipe(
        Effect.flatMap((r) => r.arrayBuffer),
        Effect.map((b) => new Uint8Array(b)),
        Effect.scoped,
      );
      return yield* media.add({
        draftId: draft.id,
        blockIndex: 0,
        kind: "image",
        ext: "webp",
        bytes,
        alt: prompt,
      });
    },
    Effect.mapError(fail("generateCover")),
  );

  return Articles.of({
    publish,
    generateCover,
    quote: { articleUsd: ARTICLE.usd, coverUsd: COVER.usd, coverModel: COVER.model },
  });
});

export const layer = Layer.effect(Articles, make);

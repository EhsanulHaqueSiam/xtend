import { ComposeError, type Draft } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as XClient from "../x/XClient.ts";
import * as DraftStore from "./DraftStore.ts";

export const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF = Duration.minutes(5);

export class Publisher extends Context.Service<
  Publisher,
  {
    /**
     * Posts block 1 then each block as a reply to the previous one, recording ids as it goes.
     * Marks the draft posted, or failed with X's detail; with `retry` a failure requeues it
     * with backoff until MAX_ATTEMPTS.
     */
    readonly post: (
      draft: Draft,
      options: { readonly purpose: string; readonly retry: boolean },
    ) => Effect.Effect<Draft, ComposeError>;
  }
>()("xtend/compose/Publisher") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const drafts = yield* DraftStore.DraftStore;

  const postBlocks = Effect.fn("Publisher.postBlocks")(function* (draft: Draft, purpose: string) {
    const ids = [...draft.postIds];
    // Resume after the last block that already went out, so a retry never double-posts.
    for (let i = ids.length; i < draft.blocks.length; i++) {
      if (i > 0 && draft.threadDelaySeconds > 0)
        yield* Effect.sleep(Duration.seconds(draft.threadDelaySeconds));
      const previous = ids[i - 1];
      const { postId } = yield* x.createPost({
        text: draft.blocks[i]!.text,
        purpose,
        ...(previous === undefined ? {} : { replyToPostId: previous }),
        ...(i === 0 && draft.replySettings !== "everyone"
          ? { replySettings: draft.replySettings }
          : {}),
        ...(i === 0 && draft.poll !== null ? { poll: draft.poll } : {}),
      });
      ids.push(postId);
      yield* drafts.setOutcome(draft.id, { postIds: ids });
    }
  });

  const post = Effect.fn("Publisher.post")(function* (
    draft: Draft,
    options: { readonly purpose: string; readonly retry: boolean },
  ) {
    const attempt = draft.attempts + 1;
    const failure =
      draft.kind === "article"
        ? "Articles cannot be posted yet: needs treg article endpoint"
        : draft.blocks.length === 0 || draft.blocks.every((b) => b.text.trim() === "")
          ? "Nothing to post"
          : null;
    const outcome =
      failure !== null
        ? failure
        : yield* postBlocks(draft, options.purpose).pipe(
            Effect.map(() => null),
            Effect.catch((e) => Effect.succeed(e.message)),
          );
    const now = yield* DateTime.now;
    yield* drafts.logRun({
      draftId: draft.id,
      attempt,
      ok: outcome === null,
      detail: outcome ?? "",
    });
    if (outcome === null)
      return yield* drafts.setOutcome(draft.id, {
        status: "posted",
        error: null,
        attempts: attempt,
        postedAt: DateTime.formatIso(now),
      });
    const requeue = options.retry && failure === null && attempt < MAX_ATTEMPTS;
    return yield* drafts.setOutcome(draft.id, {
      status: requeue ? "queued" : "failed",
      error: outcome,
      attempts: attempt,
      ...(requeue
        ? { scheduledAt: DateTime.formatIso(DateTime.addDuration(now, RETRY_BACKOFF)) }
        : {}),
    });
  });

  return Publisher.of({ post });
});

export const layer = Layer.effect(Publisher, make);

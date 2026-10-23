import { ComposeError, type Draft, hasLink } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as Articles from "./Articles.ts";
import * as DraftStore from "./DraftStore.ts";
import * as SessionPosting from "./SessionPosting.ts";

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF = Duration.minutes(5);

/** The text X receives for block i: the quote link rides on the first post until treg has quote_tweet_id. */
const blockText = (draft: Draft, i: number) => {
  const text = draft.blocks[i]?.text ?? "";
  return i === 0 && draft.quoteUrl !== null ? `${text}\n${draft.quoteUrl}` : text;
};

export class Publisher extends Context.Service<
  Publisher,
  {
    /**
     * Claims the draft, then posts block 1 and each block as a reply to the previous one,
     * recording ids as it goes. Blocks with media go through the x.com session; articles
     * through treg's article endpoints. Marks the draft posted, or failed with the detail;
     * with `retry` a failure requeues it with backoff until MAX_ATTEMPTS. Fails without
     * posting when another publisher holds the draft.
     */
    readonly post: (
      id: string,
      options: { readonly purpose: string; readonly retry: boolean },
    ) => Effect.Effect<Draft, ComposeError>;
  }
>()("xtend/compose/Publisher") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const drafts = yield* DraftStore.DraftStore;
  const session = yield* SessionPosting.SessionPosting;
  const articles = yield* Articles.Articles;
  const settings = yield* SettingsStore.SettingsStore;

  const postBlocks = Effect.fn("Publisher.postBlocks")(function* (draft: Draft, purpose: string) {
    const ids = [...draft.postIds];
    // Resume after the last block that already went out, so a retry never double-posts.
    for (let i = ids.length; i < draft.blocks.length; i++) {
      if (i > 0 && draft.threadDelaySeconds > 0)
        yield* Effect.sleep(Duration.seconds(draft.threadDelaySeconds));
      const previous = ids[i - 1] ?? (i === 0 ? (draft.replyToPostId ?? undefined) : undefined);
      const text = blockText(draft, i);
      const media = draft.media.filter((m) => m.blockIndex === i).map((m) => m.path);
      const replySettings = draft.blocks[i]?.replySettings ?? draft.replySettings;
      const { postId } =
        media.length > 0
          ? yield* session.post({
              text,
              mediaPaths: media,
              ...(previous === undefined ? {} : { replyToPostId: previous }),
            })
          : yield* x.createPost({
              text,
              purpose,
              ...(previous === undefined ? {} : { replyToPostId: previous }),
              ...(replySettings === "everyone" ? {} : { replySettings }),
              ...(i === 0 && draft.poll !== null ? { poll: draft.poll } : {}),
            });
      ids.push(postId);
      yield* drafts.setOutcome(draft.id, { postIds: ids });
    }
    return ids;
  });

  const postArticle = Effect.fn("Publisher.postArticle")(function* (draft: Draft, purpose: string) {
    const { articleId, postId } = yield* articles.publish(draft, purpose);
    yield* drafts.setOutcome(draft.id, { articleId, postIds: [postId] });
    return [postId];
  });

  /**
   * X's API cannot drop a link card, so the desktop does it in the session after posting.
   * shortcut: today the desktop only opens the post; removing the card is a TODO on the desktop side.
   */
  const hidePreview = Effect.fn("Publisher.hidePreview")(function* (draft: Draft, postId: string) {
    if (!draft.hideLinkPreviews || !draft.blocks.some((_, i) => hasLink(blockText(draft, i))))
      return null;
    const enabled = yield* settings.get.pipe(
      Effect.map((s) => s.sessionPostingEnabled),
      Effect.orElseSucceed(() => false),
    );
    if (!enabled) return "Hide link preview not applied: enable Session posting in Settings";
    return yield* session.navigate(`https://x.com/i/web/status/${postId}`).pipe(
      Effect.map(() => "Link card removal requested through your x.com session"),
      Effect.catch((e) => Effect.succeed(`Hide link preview not applied: ${e.message}`)),
    );
  });

  const post = Effect.fn("Publisher.post")(function* (
    id: string,
    options: { readonly purpose: string; readonly retry: boolean },
  ) {
    if (!(yield* drafts.claim(id)))
      return yield* new ComposeError({
        operation: "post",
        detail: "Draft is already posting or posted",
      });
    // Read after the claim so the editor's last autosave is what goes out.
    const draft = yield* drafts.get(id);
    const attempt = draft.attempts + 1;
    const failure =
      draft.kind === "article"
        ? draft.title.trim() === "" || draft.body.trim() === ""
          ? "Article needs a title and a body"
          : null
        : draft.blocks.length === 0 || draft.blocks.every((b) => b.text.trim() === "")
          ? "Nothing to post"
          : draft.poll !== null && draft.poll.options.some((o) => o.trim() === "")
            ? "Poll has a blank option"
            : null;
    const result =
      failure !== null
        ? { error: failure, ids: [] as ReadonlyArray<string> }
        : yield* (
            draft.kind === "article"
              ? postArticle(draft, options.purpose)
              : postBlocks(draft, options.purpose)
          ).pipe(
            Effect.map((ids) => ({ error: null, ids })),
            Effect.catch((e) => Effect.succeed({ error: e.message, ids: [] })),
          );
    const now = yield* DateTime.now;
    yield* drafts.logRun({
      draftId: draft.id,
      attempt,
      ok: result.error === null,
      detail: result.error ?? "",
    });
    if (result.error === null)
      return yield* drafts.setOutcome(draft.id, {
        status: "posted",
        error: null,
        attempts: attempt,
        postedAt: DateTime.formatIso(now),
        linkPreviewNote: yield* hidePreview(draft, result.ids[0] ?? ""),
      });
    const requeue = options.retry && failure === null && attempt < MAX_ATTEMPTS;
    return yield* drafts.setOutcome(draft.id, {
      status: requeue ? "queued" : "failed",
      error: result.error,
      attempts: attempt,
      ...(requeue
        ? { scheduledAt: DateTime.formatIso(DateTime.addDuration(now, RETRY_BACKOFF)) }
        : {}),
    });
  });

  return Publisher.of({ post });
});

export const layer = Layer.effect(Publisher, make);

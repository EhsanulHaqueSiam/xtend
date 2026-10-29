import {
  ComposeError,
  type DesktopUnavailableError,
  type Draft,
  hasLink,
  type XApiError,
  XId,
} from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

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

const isXId = Schema.is(XId);

/** A post that may be on X although nothing confirmed it. Retrying could post it twice, so only the user may. */
class Unconfirmed extends Schema.TaggedError<Unconfirmed>()("Unconfirmed", {
  post: Schema.Int,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Post ${this.post} may already be on X (${this.detail}); check your profile before retrying`;
  }
}

/**
 * Failures after the request went out with no answer saying how it went: a treg timeout or cut
 * connection, an unreadable 200, a desktop that went quiet or failed after typing into the composer.
 * A refusal, a missing token, the budget, no desktop at all or a desktop that refused before
 * touching x.com mean nothing was posted.
 */
const mayHavePosted = (e: ComposeError | XApiError | DesktopUnavailableError) =>
  e._tag === "XApiError"
    ? e.reason === "http" || e.reason === "decode"
    : e._tag === "DesktopUnavailableError" &&
      e.reason !== "no_desktop" &&
      e.reason !== "not_attempted";

/** Why X would refuse the draft, found before the first post goes out so a thread never stops halfway. */
const refusal = (draft: Draft): string | null => {
  if (draft.kind === "article")
    return draft.title.trim() === "" || draft.body.trim() === ""
      ? "Article needs a title and a body"
      : null;
  const hasMedia = (i: number) => draft.media.some((m) => m.blockIndex === i);
  // A post may be only media or only the quote link, but not nothing.
  const blank = draft.blocks.findIndex((_, i) => blockText(draft, i).trim() === "" && !hasMedia(i));
  if (draft.blocks.length === 0 || (blank !== -1 && draft.blocks.length === 1))
    return "Nothing to post";
  if (blank !== -1) return `Post ${blank + 1} is empty`;
  // Media goes out through the x.com session with X's default reply setting; a limit would not hold.
  const limited = draft.blocks.findIndex(
    (b, i) => hasMedia(i) && (b.replySettings ?? draft.replySettings) !== "everyone",
  );
  if (limited !== -1) return `Post ${limited + 1} has media, so it cannot limit who replies yet`;
  if (draft.poll === null) return null;
  if (draft.poll.options.some((o) => o.trim() === "")) return "Poll has a blank option";
  // X takes a poll or media on a post, not both; the session composer would silently drop the poll.
  return hasMedia(0) ? "A poll cannot share the first post with media" : null;
};

export class Publisher extends Context.Service<
  Publisher,
  {
    /**
     * Claims the draft, then posts block 1 and each block as a reply to the previous one,
     * recording ids as it goes. Blocks with media go through the x.com session; articles
     * through treg's article endpoints. Marks the draft posted, or failed with the detail;
     * with `retry` a failure requeues it with backoff until MAX_ATTEMPTS, unless the post may
     * already be on X. Fails without posting when another publisher holds the draft, or with
     * `due` when it is no longer queued for then (see DraftStore.claim).
     */
    readonly post: (
      id: string,
      options: {
        readonly purpose: string;
        readonly retry: boolean;
        readonly due?: string;
        /** The user just clicked Post: free first, so text goes through their session while that lane is on. */
        readonly clicked?: boolean;
      },
    ) => Effect.Effect<Draft, ComposeError>;
  }
>()("xtend/compose/Publisher") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const drafts = yield* DraftStore.DraftStore;
  const session = yield* SessionPosting.SessionPosting;
  const articles = yield* Articles.Articles;
  const settings = yield* SettingsStore.SettingsStore;

  const postBlocks = Effect.fn("Publisher.postBlocks")(function* (
    draft: Draft,
    purpose: string,
    clicked: boolean,
  ) {
    const ids = [...draft.postIds];
    // X's composer takes no poll and no reply-settings choice; those posts keep the API lane.
    const sessionText =
      clicked &&
      draft.poll === null &&
      (yield* settings.get.pipe(
        Effect.map((s) => s.sessionPostingEnabled),
        Effect.orElseSucceed(() => false),
      ));
    // Resume after the last block that already went out, so a retry never double-posts.
    for (let i = ids.length; i < draft.blocks.length; i++) {
      if (i > 0 && draft.threadDelaySeconds > 0)
        yield* Effect.sleep(Duration.seconds(draft.threadDelaySeconds));
      const previous = ids[i - 1] ?? (i === 0 ? (draft.replyToPostId ?? undefined) : undefined);
      const text = blockText(draft, i);
      const media = draft.media.filter((m) => m.blockIndex === i).map((m) => m.path);
      const replySettings = draft.blocks[i]?.replySettings ?? draft.replySettings;
      const unsure = <E extends ComposeError | XApiError | DesktopUnavailableError>(e: E) =>
        Effect.fail(mayHavePosted(e) ? new Unconfirmed({ post: i + 1, detail: e.message }) : e);
      const { postId } =
        media.length > 0 || (sessionText && replySettings === "everyone")
          ? yield* session
              .post({
                text,
                mediaPaths: media,
                ...(previous === undefined ? {} : { replyToPostId: previous }),
              })
              .pipe(Effect.catch(unsure))
          : yield* x
              .createPost({
                text,
                purpose,
                ...(previous === undefined ? {} : { replyToPostId: previous }),
                ...(replySettings === "everyone" ? {} : { replySettings }),
                ...(i === 0 && draft.poll !== null ? { poll: draft.poll } : {}),
              })
              .pipe(Effect.catch(unsure));
      // Accepted, so probably on X; an id that is not X's would poison the next block's reply target.
      if (!isXId(postId))
        return yield* new Unconfirmed({ post: i + 1, detail: "X answered without a post id" });
      ids.push(postId);
      yield* drafts.setOutcome(draft.id, { postIds: ids });
    }
    return ids;
  });

  const postArticle = Effect.fn("Publisher.postArticle")(function* (draft: Draft, purpose: string) {
    // Already published by an attempt that failed afterwards; publishing again would pay twice.
    if (draft.postIds.length > 0) return [...draft.postIds];
    // A publish that timed out may be live on X; like a post, it is never retried on its own.
    const { articleId, postId } = yield* articles
      .publish(draft, purpose)
      .pipe(
        Effect.catch((e) =>
          Effect.fail(mayHavePosted(e) ? new Unconfirmed({ post: 1, detail: e.message }) : e),
        ),
      );
    if (!isXId(postId))
      return yield* new Unconfirmed({
        post: 1,
        detail: "X answered the article without a post id",
      });
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
    if (!enabled) return "Hide link preview not applied: Session actions are off in Settings";
    return yield* session.navigate(`https://x.com/i/web/status/${postId}`).pipe(
      Effect.map(() => "Link card removal requested through your x.com session"),
      Effect.catch((e) => Effect.succeed(`Hide link preview not applied: ${e.message}`)),
    );
  });

  const publish = Effect.fn("Publisher.publish")(function* (
    id: string,
    options: { readonly purpose: string; readonly retry: boolean; readonly clicked?: boolean },
  ) {
    // Read after the claim so the editor's last autosave is what goes out.
    const draft = yield* drafts.get(id);
    const attempt = draft.attempts + 1;
    const failure = refusal(draft);
    const result =
      failure !== null
        ? { error: failure, ids: [] as ReadonlyArray<string>, retryable: false }
        : yield* (
            draft.kind === "article"
              ? postArticle(draft, options.purpose)
              : postBlocks(draft, options.purpose, options.clicked === true)
          ).pipe(
            Effect.map((ids) => ({ error: null, ids, retryable: false })),
            Effect.catch((e) =>
              Effect.succeed({ error: e.message, ids: [], retryable: e._tag !== "Unconfirmed" }),
            ),
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
    const requeue = options.retry && result.retryable && attempt < MAX_ATTEMPTS;
    return yield* drafts.setOutcome(draft.id, {
      status: requeue ? "queued" : "failed",
      error: result.error,
      attempts: attempt,
      ...(requeue
        ? { scheduledAt: DateTime.formatIso(DateTime.addDuration(now, RETRY_BACKOFF)) }
        : {}),
    });
  });

  const scope = yield* Effect.scope;

  const post = Effect.fn("Publisher.post")(function* (
    id: string,
    options: {
      readonly purpose: string;
      readonly retry: boolean;
      readonly due?: string;
      readonly clicked?: boolean;
    },
  ) {
    if (!(yield* drafts.claim(id, options.due)))
      return yield* new ComposeError({
        operation: "post",
        detail: "Draft is already posting or posted",
      });
    // The publish lives in the service's scope, not the caller's: closing the tab or dropping the
    // socket mid-thread must not stop it halfway. Anything that still stops it (a defect, a store
    // error, shutdown) leaves it failed with the ids so far, so a retry resumes instead of the
    // draft sitting in `posting` until a restart.
    const fiber = yield* publish(id, options).pipe(
      Effect.onError((cause) =>
        drafts
          .setOutcome(id, {
            status: "failed",
            error: Cause.hasInterruptsOnly(cause)
              ? `interrupted before it finished; ${DraftStore.IN_FLIGHT}`
              : String(Cause.squash(cause)).slice(0, 300),
          })
          .pipe(Effect.ignore),
      ),
      Effect.forkIn(scope),
    );
    return yield* Fiber.join(fiber);
  });

  return Publisher.of({ post });
});

export const layer = Layer.effect(Publisher, make);

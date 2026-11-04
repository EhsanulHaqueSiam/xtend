import {
  articleBlocker,
  charCount,
  ComposeError,
  type DesktopUnavailableError,
  type Draft,
  hasLink,
  type PickedGif,
  type PostCommunity,
  POST_LIMIT,
  toPasteHtml,
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
 * connection, an unreadable 200, a desktop that went quiet or failed after pressing Post.
 * A refusal, a missing token, the budget, no desktop at all or a desktop that refused before
 * pressing Post mean nothing was posted.
 */
const mayHavePosted = (e: ComposeError | XApiError | DesktopUnavailableError) =>
  e._tag === "XApiError"
    ? e.reason === "http" || e.reason === "decode"
    : e._tag === "DesktopUnavailableError" &&
      e.reason !== "no_desktop" &&
      e.reason !== "not_attempted";

/**
 * Why X would refuse the draft, found before the first post goes out so a thread never stops
 * halfway. `gif`: the click picked one for the first post; `community`, the first post's audience.
 */
const refusal = (draft: Draft, gif: boolean, community: boolean): string | null => {
  if (draft.kind === "article") return articleBlocker(draft.title, draft.body);
  const hasMedia = (i: number) => draft.media.some((m) => m.blockIndex === i) || (i === 0 && gif);
  // A post may be only media or only the quote link, but not nothing.
  const blank = draft.blocks.findIndex((_, i) => blockText(draft, i).trim() === "" && !hasMedia(i));
  if (draft.blocks.length === 0 || (blank !== -1 && draft.blocks.length === 1))
    return "Nothing to post";
  if (blank !== -1) return `Post ${blank + 1} is empty`;
  const long = draft.blocks.findIndex((_, i) => charCount(blockText(draft, i)) > POST_LIMIT);
  if (long !== -1) return `Post ${long + 1} is over ${POST_LIMIT} characters`;
  if (gif && draft.media.some((m) => m.blockIndex === 0))
    return "A GIF cannot share the first post with media";
  // X's composer offers no audience on a reply, and a Community decides who replies to its posts.
  if (community && draft.replyToPostId !== null)
    return "A reply goes where its post is, not to a Community";
  if (community && (draft.blocks[0]?.replySettings ?? draft.replySettings) !== "everyone")
    return "A Community post's replies are the Community's: keep Everyone can reply";
  if (draft.poll === null) return null;
  if (draft.poll.options.some((o) => o.trim() === "")) return "Poll has a blank option";
  // X takes a poll or media on a post, not both.
  return hasMedia(0) ? "A poll cannot share the first post with media" : null;
};

export class Publisher extends Context.Service<
  Publisher,
  {
    /**
     * Claims the draft and posts it as a thread, recording ids as it goes. With `retry` a failure
     * requeues it with backoff until MAX_ATTEMPTS, unless the post may already be on X. Posts
     * nothing when another publisher holds the draft or it is no longer queued for `due`.
     */
    readonly post: (
      id: string,
      options: {
        readonly purpose: string;
        readonly retry: boolean;
        readonly due?: string;
        /** The user just clicked Post: free first, so it goes through their session while that lane is on. */
        readonly clicked?: boolean;
        /** The click showed no price: a post the session cannot take fails instead of going paid. */
        readonly sessionOnly?: boolean;
        /** Picked in X's GIF search for the first post; only the session can post it. */
        readonly gif?: PickedGif;
        /** The first post's audience, set in X's own composer; only the session can post to one. */
        readonly community?: PostCommunity;
        /** An Article's caption for X's Publish dialog; only the session can set one. */
        readonly caption?: string;
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
    sessionOnly: boolean,
    gif: PickedGif | undefined,
    community: PostCommunity | undefined,
  ) {
    const ids = [...draft.postIds];
    // A click goes through the user's own composer, poll and who-can-reply included; unattended
    // posts keep the API. Media, a GIF and bold or italic only the session can add, so they wait
    // for a click.
    const sessionClick =
      clicked &&
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
      const poll = i === 0 && draft.poll !== null ? { poll: draft.poll } : {};
      const picked =
        i === 0
          ? {
              ...(gif === undefined ? {} : { gif }),
              ...(community === undefined ? {} : { community }),
            }
          : {};
      const styles = draft.blocks[i]?.styles ?? [];
      // Media and formatting ride only the session, and the session only acts on a click.
      if ((media.length > 0 || styles.length > 0) && !clicked)
        return yield* new ComposeError({
          operation: "post",
          detail: `Posts with ${media.length > 0 ? "media" : "formatting"} need your click: press Post now`,
        });
      const { postId } =
        media.length > 0 || Object.keys(picked).length > 0 || styles.length > 0 || sessionClick
          ? yield* session
              .post({
                text,
                mediaPaths: media,
                replySettings,
                ...poll,
                ...picked,
                ...(styles.length === 0 ? {} : { styles }),
                ...(previous === undefined ? {} : { replyToPostId: previous }),
              })
              .pipe(Effect.catch(unsure))
          : sessionOnly
            ? yield* new ComposeError({
                operation: "post",
                detail: "Session actions are off in Settings, X session",
              })
            : yield* x
                .createPost({
                  text,
                  purpose,
                  ...(previous === undefined ? {} : { replyToPostId: previous }),
                  ...(replySettings === "everyone" ? {} : { replySettings }),
                  ...poll,
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

  const postArticle = Effect.fn("Publisher.postArticle")(function* (
    draft: Draft,
    purpose: string,
    clicked: boolean,
    caption: string | undefined,
  ) {
    // Already published by an attempt that failed afterwards; publishing again would pay twice.
    if (draft.postIds.length > 0) return [...draft.postIds];
    const cover = draft.media.find((m) => m.blockIndex === 0 && m.kind === "image");
    if (clicked) {
      // The user's click goes through X's own editor, free; X's paste keeps only text blocks.
      const html = toPasteHtml(draft.body);
      if (html === null)
        return yield* new ComposeError({
          operation: "articlePublish",
          detail:
            "X's editor takes code, Markdown, LaTeX, dividers and posts only from its own Insert menu: Queue or Schedule sends them through the X API",
        });
      const { postId } = yield* session
        .article({
          title: draft.title,
          html,
          replySettings: draft.replySettings,
          ...(cover === undefined ? {} : { coverPath: cover.path }),
          ...(caption === undefined ? {} : { caption }),
        })
        .pipe(
          Effect.mapError((e) =>
            mayHavePosted(e) ? new Unconfirmed({ post: 1, detail: e.message }) : e,
          ),
        );
      if (!isXId(postId))
        return yield* new Unconfirmed({
          post: 1,
          detail: "X answered the article without a post id",
        });
      yield* drafts.setOutcome(draft.id, { postIds: [postId] });
      return [postId];
    }
    // X's publish endpoint takes no reply setting or caption, and treg uploads no media yet.
    if (cover !== undefined)
      return yield* new ComposeError({
        operation: "articlePublish",
        detail: "A cover goes out only with Publish now: the X API lane cannot upload media yet",
      });
    if (draft.replySettings !== "everyone")
      return yield* new ComposeError({
        operation: "articlePublish",
        detail: "Through the X API everyone can reply: Publish now sets who can reply",
      });
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

  // X's API cannot drop a link card and nothing removes one after posting, so a draft that
  // asked for it (before the editor stopped offering it) is told it was kept.
  const hidePreview = (draft: Draft) =>
    draft.hideLinkPreviews && draft.blocks.some((_, i) => hasLink(blockText(draft, i)))
      ? "Link preview kept: Xtend cannot hide it yet"
      : null;

  const publish = Effect.fn("Publisher.publish")(function* (
    id: string,
    options: {
      readonly purpose: string;
      readonly retry: boolean;
      readonly clicked?: boolean;
      readonly sessionOnly?: boolean;
      readonly gif?: PickedGif;
      readonly community?: PostCommunity;
      readonly caption?: string;
    },
  ) {
    // Read after the claim so the editor's last autosave is what goes out.
    const draft = yield* drafts.get(id);
    const attempt = draft.attempts + 1;
    const failure = refusal(draft, options.gif !== undefined, options.community !== undefined);
    const result =
      failure !== null
        ? { error: failure, ids: [] as ReadonlyArray<string>, retryable: false }
        : yield* (
            draft.kind === "article"
              ? postArticle(draft, options.purpose, options.clicked === true, options.caption)
              : postBlocks(
                  draft,
                  options.purpose,
                  options.clicked === true,
                  options.sessionOnly === true,
                  options.gif,
                  options.community,
                )
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
        linkPreviewNote: hidePreview(draft),
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
      readonly sessionOnly?: boolean;
      readonly gif?: PickedGif;
      readonly community?: PostCommunity;
      readonly caption?: string;
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

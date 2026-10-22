import {
  EngageError,
  type Mention,
  type ReplyDraft,
  type ReplyTarget,
  type SentReply,
  type XApiError,
  type XPost,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as EngageStore from "./EngageStore.ts";
import { rankTarget } from "./ranking.ts";

const MAX_TARGETS = 30;

const assistError = (e: Assist.AssistError) =>
  new EngageError({ operation: "assist", detail: e.message });
const settingsError = (e: { readonly message: string }) =>
  new EngageError({ operation: "settings", detail: e.message });

export interface KeywordSuggestions {
  readonly keywords: ReadonlyArray<string>;
  readonly handles: ReadonlyArray<string>;
}

export interface MentionsResult {
  readonly mentions: ReadonlyArray<Mention>;
  readonly apiError: string | null;
}

/** Reply targets, AI reply drafts, X writes and mentions. Persistence is EngageStore. */
export class Engage extends Context.Service<
  Engage,
  {
    readonly targets: Effect.Effect<ReadonlyArray<ReplyTarget>, EngageError | XApiError>;
    readonly draftReply: (post: XPost) => Effect.Effect<ReadonlyArray<ReplyDraft>, EngageError>;
    /** Posts the reply through X; a failure is recorded on the row, never thrown. */
    readonly reply: (post: XPost, text: string) => Effect.Effect<SentReply, EngageError>;
    readonly like: (postId: string) => Effect.Effect<void, XApiError>;
    readonly findKeywords: Effect.Effect<KeywordSuggestions, EngageError | XApiError>;
    readonly mentions: Effect.Effect<MentionsResult, EngageError>;
  }
>()("xtend/engage/Engage") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const observations = yield* ObservationStore.ObservationStore;
  const store = yield* EngageStore.EngageStore;

  const current = settings.get.pipe(Effect.mapError(settingsError));

  const targets = Effect.gen(function* () {
    const { keywords } = yield* current;
    const replied = yield* store.repliedPostIds;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const seen = new Set<string>();
    const all: Array<ReplyTarget> = [];
    for (const keyword of keywords.slice(0, 5)) {
      // shortcut: XClient caches search pages for 30 min, not the 15 the screen asks for; upgrade when XClient takes a cacheFor option.
      const page = yield* x.searchPosts(keyword, { mode: "latest", purpose: "engage.targets" });
      for (const post of page.items) {
        if (seen.has(post.postId) || post.isRepost) continue;
        seen.add(post.postId);
        all.push({ post, keyword, ...rankTarget(post, nowMs), replied: replied.has(post.postId) });
      }
    }
    return all.sort((a, b) => b.score - a.score).slice(0, MAX_TARGETS);
  });

  const draftReply = Effect.fn("Engage.draftReply")(function* (post: XPost) {
    const { drafts } = yield* assist
      .generate({
        task: "engage.draftReply",
        instructions:
          "Write 3 different replies to this post in the user's voice. Each under 280 characters, no praise or flattery, no questions for the sake of it; each adds one concrete point, example, number or counterpoint the author did not say.",
        input: { author: post.author.handle, text: post.text },
        output: Schema.Struct({ drafts: Schema.Array(Schema.Struct({ text: Schema.String })) }),
      })
      .pipe(Effect.mapError(assistError));
    return drafts.filter((d) => d.text.length <= 280).slice(0, 3);
  });

  const reply = Effect.fn("Engage.reply")(function* (post: XPost, text: string) {
    const result = yield* x
      .createPost({ text, replyToPostId: post.postId, purpose: "engage.reply" })
      .pipe(
        Effect.map((r) => ({ postId: r.postId, error: null })),
        Effect.catchTag("XApiError", (e) => Effect.succeed({ postId: null, error: e.message })),
      );
    return yield* store.recordReply({
      targetPostId: post.postId,
      targetUrl: post.url,
      targetHandle: post.author.handle,
      text,
      ...result,
    });
  });

  const like = Effect.fn("Engage.like")(function* (postId: string) {
    yield* x.like(postId, "engage.like");
  });

  const findKeywords = Effect.gen(function* () {
    const { handle, keywords } = yield* current;
    if (handle === null)
      return yield* new EngageError({
        operation: "settings",
        detail: "Set your X handle in Settings first.",
      });
    const page = yield* x.userPosts(handle, { purpose: "engage.findKeywords" });
    return yield* assist
      .generate({
        task: "engage.findKeywords",
        instructions:
          "From the user's own recent posts and current keywords, return 10 search keywords (2 to 3 words each, the phrases their audience actually types) that would surface posts worth replying to, and 5 X handles (without @) of accounts in this niche whose posts get replies. Do not repeat current keywords.",
        input: { keywords, posts: page.items.slice(0, 20).map((p) => p.text) },
        output: Schema.Struct({
          keywords: Schema.Array(Schema.String),
          handles: Schema.Array(Schema.String),
        }),
      })
      .pipe(Effect.mapError(assistError));
  });

  const mentions = Effect.gen(function* () {
    const { handle } = yield* current;
    const handled = yield* store.handledMentionIds;
    const api = yield* x.mentions({ purpose: "engage.mentions" }).pipe(
      Effect.map((posts) => ({ posts, error: null })),
      Effect.catchTag("XApiError", (e) =>
        Effect.succeed({ posts: [] as ReadonlyArray<XPost>, error: e.message }),
      ),
    );
    const tag = handle === null ? null : `@${handle.toLowerCase()}`;
    const observed =
      tag === null
        ? []
        : (yield* observations
            .listRecent({ limit: 200 })
            .pipe(
              Effect.mapError((e) => new EngageError({ operation: "store", detail: e.message })),
            )).posts.filter((p) => p.text.toLowerCase().includes(tag));
    const seen = new Set(api.posts.map((p) => p.postId));
    const list: Array<Mention> = api.posts.map((post) => ({
      post,
      source: "api",
      handled: handled.has(post.postId),
    }));
    for (const p of observed) {
      if (seen.has(p.postId)) continue;
      list.push({
        source: "session",
        handled: handled.has(p.postId),
        post: {
          postId: p.postId,
          url: `https://x.com/${p.author.handle}/status/${p.postId}`,
          text: p.text,
          createdAt: p.createdAt,
          lang: null,
          isReply: p.isReply,
          isRepost: false,
          hasMedia: p.hasMedia,
          hasLink: p.hasLink,
          author: { ...p.author, avatarUrl: null },
          metrics: p.metrics,
        },
      });
    }
    list.sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt));
    return { mentions: list, apiError: api.error } satisfies MentionsResult;
  });

  return Engage.of({ targets, draftReply, reply, like, findKeywords, mentions });
});

export const layer = Layer.effect(Engage, make);

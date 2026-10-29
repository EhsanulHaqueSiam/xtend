import {
  type DmEvent,
  EngageError,
  type Mention,
  type NicheProfile,
  type ReplyDraft,
  type ReplyTarget,
  type ReplyTone,
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
import * as SessionPosting from "../compose/SessionPosting.ts";
import * as Events from "../events/Events.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as Treg from "../x/Treg.ts";
import * as XClient from "../x/XClient.ts";
import { DM_EVENTS_QUOTE_USD, fetchDmEvents } from "./DmEvents.ts";
import * as EngageStore from "./EngageStore.ts";
import { matchIncoming, observedToPost, tagsHandle } from "./inbox.ts";
import { rankTarget } from "./ranking.ts";

const MAX_TARGETS = 30;
/** Keywords one targets refresh searches; Costs prices a refresh from it. */
export const MAX_KEYWORDS = 5;

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

export interface InboxResult {
  readonly sent: ReadonlyArray<SentReply>;
  readonly followUps: ReadonlyArray<SentReply>;
  readonly incoming: ReadonlyArray<Mention>;
}

export interface DmsResult {
  readonly events: ReadonlyArray<DmEvent>;
  readonly error: string | null;
  readonly quoteUsd: number;
}

/** Handles a reply opens with, lowercased: "@a @b text" gives a and b. */
const leadingHandles = (text: string) =>
  (text.match(/^(?:@\w+\s*)+/)?.[0] ?? "")
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((t) => t.slice(1).toLowerCase());

/** Reply targets, AI reply drafts, X writes and mentions. Persistence is EngageStore. */
export class Engage extends Context.Service<
  Engage,
  {
    readonly targets: Effect.Effect<ReadonlyArray<ReplyTarget>, EngageError | XApiError>;
    readonly draftReply: (
      post: XPost,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<ReplyDraft>, EngageError>;
    /** Posts the reply through X; a failure is recorded on the row, never thrown. */
    readonly reply: (post: XPost, text: string) => Effect.Effect<SentReply, EngageError>;
    readonly like: (postId: string) => Effect.Effect<void, XApiError>;
    readonly findKeywords: Effect.Effect<KeywordSuggestions, EngageError | XApiError>;
    readonly mentions: (refresh: boolean) => Effect.Effect<MentionsResult, EngageError>;
    readonly inbox: Effect.Effect<InboxResult, EngageError>;
    /** Who the user replies to and what about; rebuilt nightly and on demand. */
    readonly nicheRebuild: Effect.Effect<NicheProfile, EngageError>;
    readonly dms: (load: boolean) => Effect.Effect<DmsResult, EngageError>;
  }
>()("xtend/engage/Engage") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const observations = yield* ObservationStore.ObservationStore;
  const store = yield* EngageStore.EngageStore;
  const events = yield* Events.Events;
  const treg = yield* Treg.Treg;

  const session = yield* SessionPosting.SessionPosting;
  const current = settings.get.pipe(Effect.mapError(settingsError));
  const observedError = (e: { readonly message: string }) =>
    new EngageError({ operation: "store", detail: e.message });

  const targets = Effect.gen(function* () {
    const { keywords } = yield* current;
    const replied = yield* store.repliedPostIds;
    const history = yield* store.repliesByAuthor;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const seen = new Set<string>();
    const found: Array<{ post: XPost; keyword: string }> = [];
    for (const keyword of keywords.slice(0, MAX_KEYWORDS)) {
      // shortcut: XClient caches search pages for 30 min, not the 15 the screen asks for; upgrade when XClient takes a cacheFor option.
      const page = yield* x.searchPosts(keyword, { mode: "latest", purpose: "engage.targets" });
      for (const post of page.items) {
        if (seen.has(post.postId) || post.isRepost) continue;
        seen.add(post.postId);
        found.push({ post, keyword });
      }
    }
    const scores = yield* store.authorScores(found.map((f) => f.post.author.handle));
    const all = found.map(({ post, keyword }): ReplyTarget => {
      const handle = post.author.handle.toLowerCase();
      const authorScore = scores.get(handle) ?? null;
      const rank = rankTarget(post, nowMs, authorScore);
      return {
        post,
        keyword,
        ageMinutes: rank.ageMinutes,
        viewsPerHour: rank.viewsPerHour,
        score: rank.score,
        reach: rank.reach,
        replied: replied.has(post.postId),
        authorScore,
        repliesToAuthor: history.get(handle) ?? 0,
      };
    });
    return all.sort((a, b) => b.score - a.score).slice(0, MAX_TARGETS);
  });

  const draftReply = Effect.fn("Engage.draftReply")(function* (post: XPost, tone?: ReplyTone) {
    const { drafts } = yield* assist
      .generate({
        task: "engage.draftReply",
        instructions: `Write 3 different replies to this post in the user's voice. Each under 280 characters, no praise or flattery, no questions for the sake of it; each adds one concrete point, example, number or counterpoint the author did not say.`,
        tone,
        input: { author: post.author.handle, text: post.text },
        output: Schema.Struct({ drafts: Schema.Array(Schema.Struct({ text: Schema.String })) }),
      })
      .pipe(Effect.mapError(assistError));
    return drafts.filter((d) => d.text.length <= 280).slice(0, 3);
  });

  // Free first: a clicked reply goes through the user's own session while that lane is on.
  // Nothing attempted (lane off, no desktop, human pace) fails the call; a refusal or a
  // desktop that went quiet after it may have clicked Post is kept on the row like X's own.
  const reply = Effect.fn("Engage.reply")(function* (post: XPost, text: string) {
    const { sessionPostingEnabled } = yield* current;
    const result = sessionPostingEnabled
      ? yield* session.post({ text, mediaPaths: [], replyToPostId: post.postId, paced: true }).pipe(
          Effect.map((r) => ({ postId: r.postId, error: null })),
          Effect.catch((e) =>
            e._tag === "DesktopUnavailableError" &&
            (e.reason === "timeout" || e.reason === "failed")
              ? Effect.succeed({ postId: null, error: e.message })
              : new EngageError({ operation: "session", detail: e.message }),
          ),
        )
      : yield* x.createPost({ text, replyToPostId: post.postId, purpose: "engage.reply" }).pipe(
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
        detail: "No X handle yet. It comes from your X session, or set it in Settings.",
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

  const mentions = Effect.fn("Engage.mentions")(function* (refresh: boolean) {
    const { handle } = yield* current;
    const handled = yield* store.handledMentionIds;
    // Only an explicit refresh pays X, and only for mentions newer than the last one stored.
    const apiError = refresh
      ? yield* Effect.gen(function* () {
          const sinceId = yield* store.latestApiMentionId;
          const fresh = yield* x.mentions({
            purpose: "engage.mentions",
            ...(sinceId === null ? {} : { sinceId }),
          });
          yield* store.storeApiMentions(fresh);
          if (fresh.length > 0)
            yield* events.publish({ type: "mention_arrived", payload: { count: fresh.length } });
          return null;
        }).pipe(Effect.catchTag("XApiError", (e) => Effect.succeed(e.message)))
      : null;
    const api = { posts: yield* store.apiMentions, error: apiError };
    const observed =
      handle === null
        ? []
        : (yield* observations
            .listRecent({ limit: 200 })
            .pipe(Effect.mapError(observedError))).posts.filter((p) => tagsHandle(p.text, handle));
    const seen = new Set(api.posts.map((p) => p.postId));
    const list: Array<Mention> = api.posts.map((post) => ({
      post,
      source: "api",
      handled: handled.has(post.postId),
    }));
    for (const p of observed) {
      if (seen.has(p.postId)) continue;
      list.push({ source: "session", handled: handled.has(p.postId), post: observedToPost(p) });
    }
    list.sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt));
    return { mentions: list, apiError: api.error } satisfies MentionsResult;
  });

  const inbox = Effect.gen(function* () {
    const { handle } = yield* current;
    const handled = yield* store.handledMentionIds;
    const posts =
      handle === null
        ? []
        : matchIncoming(
            (yield* observations.listRecent({ limit: 200 }).pipe(Effect.mapError(observedError)))
              .posts,
            handle,
          );
    // A row seen for the first time publishes mention_arrived, once per account across restarts.
    const fresh = yield* store.announce(posts.map((p) => p.postId));
    if (fresh > 0) yield* events.publish({ type: "mention_arrived", payload: { count: fresh } });
    const incoming = posts
      .map((post): Mention => ({ post, source: "session", handled: handled.has(post.postId) }))
      .sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt));
    const engagerIds = [...new Set(posts.map((p) => p.author.userId))];
    return {
      sent: yield* store.sentList(engagerIds),
      followUps: yield* store.followUps,
      incoming,
    } satisfies InboxResult;
  });

  const nicheRebuild = Effect.gen(function* () {
    const { handle, keywords } = yield* current;
    const counts = new Map(yield* store.repliesByAuthor);
    if (handle !== null) {
      const own = yield* observations
        .listRecent({ limit: 200, authorHandle: handle })
        .pipe(Effect.mapError(observedError));
      for (const p of own.posts) {
        if (!p.isReply) continue;
        for (const h of leadingHandles(p.text)) {
          if (h !== handle.toLowerCase()) counts.set(h, (counts.get(h) ?? 0) + 1);
        }
      }
    }
    const handles = [...counts]
      .map(([h, replies]) => ({ handle: h, replies }))
      .sort((a, b) => b.replies - a.replies)
      .slice(0, 10);
    return yield* store.nicheSet({ handles, topics: keywords });
  });

  const dms = Effect.fn("Engage.dms")(function* (load: boolean) {
    const result = load
      ? yield* fetchDmEvents("engage.dms").pipe(
          Effect.map((events) => ({ events, error: null })),
          Effect.catchTag("XApiError", (e) => Effect.succeed({ events: [], error: e.message })),
          Effect.provideService(Treg.Treg, treg),
        )
      : { events: [], error: null };
    return { ...result, quoteUsd: DM_EVENTS_QUOTE_USD } satisfies DmsResult;
  });

  return Engage.of({
    targets,
    draftReply,
    reply,
    like,
    findKeywords,
    mentions,
    inbox,
    nicheRebuild,
    dms,
  });
});

export const layer = Layer.effect(Engage, make);

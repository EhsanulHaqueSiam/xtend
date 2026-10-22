import {
  hasLink,
  type RateCard,
  XApiError,
  type XFollower,
  type XPost,
  type XProfile,
  type XSearchMode,
  type XTrend,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Treg from "./Treg.ts";

/** Catalog ids pinned on purpose: routed endpoints answer in whichever provider's shape served. */
const ENDPOINTS = {
  searchPosts: "anyapi.x.search.posts",
  profile: "anyapi.x.user.profile",
  userPosts: "anyapi.x.user.posts.timeline",
  followers: "tikhub.x.twitter-web-fetch-user-followers",
  trending: "tikhub.x.twitter-web-fetch-trending",
  /** The team's own X connection through treg; X's rate card applies. */
  own: "x",
} as const;

/**
 * The one rate card: X's prices as treg bills them plus treg's scraper rates.
 * Every quote a client shows and every budget reservation starts here.
 */
export const RATE_CARD: RateCard = {
  post: 0.015,
  postWithLink: 0.2,
  like: 0.015,
  repost: 0.015,
  follow: 0.015,
  dm: 0.015,
  delete: 0.01,
  readPage: 0.005,
  profile: 0.01,
  searchPage: 0.00075,
  scraperProfile: 0.00022,
  followersPage: 0.001,
  trending: 0.001,
};

export const postCostUsd = (text: string) =>
  hasLink(text) ? RATE_CARD.postWithLink : RATE_CARD.post;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number => Math.max(0, Math.trunc(num(v) ?? 0));
const isoFromUtc = (seconds: unknown): string | null =>
  num(seconds) === null ? null : DateTime.formatIso(DateTime.makeUnsafe(num(seconds)! * 1000));
// X's "Wed Oct 22 10:00:00 +0000 2026" form; DateTime parses it like Date does.
const isoFromText = (text: string): string | null =>
  DateTime.make(text).pipe((o) => (o._tag === "Some" ? DateTime.formatIso(o.value) : null));

// A post with no id or date cannot be ranked, scheduled against or charted, so it is dropped
// rather than stored at the epoch.
const postFromAnyapi = (row: Json, fallbackHandle: string): XPost | null => {
  const text = str(row.text);
  const handle = (str(row.authorUsername ?? row.authorHandle) || fallbackHandle).toLowerCase();
  const createdAt = isoFromUtc(row.createdUtc) ?? isoFromText(str(row.createdAt));
  if (str(row.id) === "" || createdAt === null) return null;
  return {
    postId: str(row.id),
    url: str(row.url) || `https://x.com/${handle}/status/${str(row.id)}`,
    text,
    createdAt,
    lang: typeof row.lang === "string" ? row.lang : null,
    isReply: row.isReply === true,
    isRepost: text.startsWith("RT @"),
    hasMedia: arr(row.media).length > 0,
    hasLink: hasLink(text),
    author: {
      userId: str(row.authorId),
      handle,
      name: str(row.authorName) || handle,
      followers: num(row.authorFollowers),
      verified: row.authorVerified === true,
      avatarUrl: str(row.authorImage) || null,
    },
    metrics: {
      views: num(row.viewCount ?? row.views),
      likes: int(row.likeCount ?? row.likes),
      reposts: int(row.retweetCount ?? row.retweets),
      replies: int(row.replyCount ?? row.replies),
      quotes: int(row.quoteCount ?? row.quotes),
      bookmarks: int(row.bookmarkCount ?? row.bookmarks),
    },
  };
};

const profileFromAnyapi = (d: Json): XProfile => ({
  userId: str(d.id),
  handle: str(d.handle).toLowerCase(),
  name: str(d.displayName) || str(d.handle),
  bio: str(d.bio),
  followers: int(d.followers),
  following: int(d.following),
  posts: int(d.tweets),
  verified: d.verified === true,
  avatarUrl: str(d.avatarUrl).replace("_normal", "_400x400") || null,
  createdAt: isoFromUtc(d.createdUtc),
  location: str(d.location) || null,
  website: str(d.website) || null,
});

const followerFromTikhub = (row: Json): XFollower | null => {
  const legacy = obj(row.legacy);
  const handle = str(row.screen_name ?? legacy.screen_name).toLowerCase();
  if (handle === "") return null;
  return {
    userId: str(row.rest_id ?? row.id ?? row.user_id),
    handle,
    name: str(row.name ?? legacy.name) || handle,
    followers: int(row.followers_count ?? legacy.followers_count),
    following: int(row.friends_count ?? legacy.friends_count),
    verified: row.is_blue_verified === true || legacy.verified === true,
    bio: str(row.description ?? legacy.description),
    createdAt: isoFromText(str(row.created_at ?? legacy.created_at)),
  };
};

export interface SearchOptions {
  readonly mode?: XSearchMode;
  readonly limit?: number;
  readonly cursor?: string;
  readonly purpose: string;
}

export interface Page<A> {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor: string | null;
  /** Served from the read cache: nothing was charged. */
  readonly fromCache: boolean;
}

/** Cache probes for the reads a screen is about to pay for; `costs.quote` uses them. */
export interface CacheProbes {
  readonly search: (query: string, mode?: XSearchMode) => Effect.Effect<boolean>;
  readonly profile: (handle: string) => Effect.Effect<boolean>;
  readonly userPosts: (handle: string) => Effect.Effect<boolean>;
  readonly followers: (handle: string) => Effect.Effect<boolean>;
  readonly trending: (country: string) => Effect.Effect<boolean>;
  readonly mentions: Effect.Effect<boolean>;
}

export interface CreatePostInput {
  readonly text: string;
  readonly replyToPostId?: string;
  readonly replySettings?: "following" | "mentionedUsers" | "subscribers" | "verified";
  readonly poll?: { readonly options: ReadonlyArray<string>; readonly durationMinutes: number };
  readonly purpose: string;
}

/**
 * Typed X reads and writes. Reads come from scraper providers (cheap, no key);
 * writes and own-account reads go through the user's X connection in treg.
 * Every method names the screen paying for it so the spend meter stays honest.
 */
export class XClient extends Context.Service<
  XClient,
  {
    /** X advanced search syntax works: `from:`, `min_faves:`, `since:`, OR. */
    readonly searchPosts: (
      query: string,
      options: SearchOptions,
    ) => Effect.Effect<Page<XPost>, XApiError>;
    readonly profile: (
      handle: string,
      purpose: string,
    ) => Effect.Effect<XProfile | null, XApiError>;
    readonly userPosts: (
      handle: string,
      options: { readonly cursor?: string; readonly purpose: string },
    ) => Effect.Effect<Page<XPost>, XApiError>;
    readonly followers: (
      handle: string,
      options: { readonly cursor?: string; readonly purpose: string },
    ) => Effect.Effect<Page<XFollower>, XApiError>;
    readonly trending: (
      country: string,
      purpose: string,
    ) => Effect.Effect<ReadonlyArray<XTrend>, XApiError>;
    /** The connected account. Null when treg has no X connection. */
    readonly me: (
      purpose: string,
    ) => Effect.Effect<
      { readonly userId: string; readonly handle: string; readonly name: string } | null,
      XApiError
    >;
    readonly createPost: (
      input: CreatePostInput,
    ) => Effect.Effect<{ readonly postId: string; readonly costUsd: number }, XApiError>;
    readonly deletePost: (postId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly like: (postId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly repost: (postId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly sendDm: (
      participantId: string,
      text: string,
      purpose: string,
    ) => Effect.Effect<void, XApiError>;
    readonly mentions: (options: {
      readonly sinceId?: string;
      readonly purpose: string;
    }) => Effect.Effect<ReadonlyArray<XPost>, XApiError>;
    readonly cached: CacheProbes;
  }
>()("xtend/x/XClient") {}

export const make = Effect.gen(function* () {
  const treg = yield* Treg.Treg;

  const clean = (handle: string) => handle.replace(/^@/, "").toLowerCase();
  const posts = (rows: ReadonlyArray<unknown>, fallbackHandle: string) =>
    rows.flatMap((row) => {
      const p = postFromAnyapi(obj(row), fallbackHandle);
      return p === null ? [] : [p];
    });

  // Each read is a call builder plus a parser so the cache probe and the call share one key.
  const searchCall = (query: string, options: Omit<SearchOptions, "purpose">): Treg.TregCall => ({
    endpoint: ENDPOINTS.searchPosts,
    body: {
      query,
      limit: options.limit ?? 20,
      queryType: options.mode === "latest" ? "Latest" : "Top",
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    },
    purpose: "",
    cacheFor: Duration.minutes(30),
    expectedCostUsd: RATE_CARD.searchPage,
  });
  const profileCall = (handle: string): Treg.TregCall => ({
    endpoint: ENDPOINTS.profile,
    body: { handle: clean(handle) },
    purpose: "",
    cacheFor: Duration.hours(6),
    expectedCostUsd: RATE_CARD.scraperProfile,
  });
  const userPostsCall = (handle: string, cursor?: string): Treg.TregCall => ({
    endpoint: ENDPOINTS.userPosts,
    body: { handle: clean(handle), ...(cursor === undefined ? {} : { cursor }) },
    purpose: "",
    cacheFor: Duration.hours(1),
    expectedCostUsd: RATE_CARD.searchPage,
  });
  const followersCall = (handle: string, cursor?: string): Treg.TregCall => ({
    endpoint: ENDPOINTS.followers,
    query: { screen_name: clean(handle), cursor },
    purpose: "",
    cacheFor: Duration.hours(12),
    expectedCostUsd: RATE_CARD.followersPage,
  });
  const trendingCall = (country: string): Treg.TregCall => ({
    endpoint: ENDPOINTS.trending,
    query: { country },
    purpose: "",
    cacheFor: Duration.minutes(30),
    expectedCostUsd: RATE_CARD.trending,
  });

  const searchPosts = Effect.fn("XClient.searchPosts")(function* (
    query: string,
    options: SearchOptions,
  ) {
    const response = yield* treg.call({ ...searchCall(query, options), purpose: options.purpose });
    const data = obj(obj(obj(response.body).output).data);
    return {
      items: posts(arr(data.items), ""),
      nextCursor: str(data.nextCursor) || null,
      fromCache: response.cached,
    };
  });

  const profile = Effect.fn("XClient.profile")(function* (handle: string, purpose: string) {
    const response = yield* treg.call({ ...profileCall(handle), purpose });
    const output = obj(obj(response.body).output);
    return output.found === true ? profileFromAnyapi(obj(output.data)) : null;
  });

  const userPosts = Effect.fn("XClient.userPosts")(function* (
    handle: string,
    options: { readonly cursor?: string; readonly purpose: string },
  ) {
    const response = yield* treg.call({
      ...userPostsCall(handle, options.cursor),
      purpose: options.purpose,
    });
    const data = obj(obj(obj(response.body).output).data);
    return {
      items: posts(arr(data.tweets), clean(handle)),
      nextCursor: str(data.nextCursor) || null,
      fromCache: response.cached,
    };
  });

  const followers = Effect.fn("XClient.followers")(function* (
    handle: string,
    options: { readonly cursor?: string; readonly purpose: string },
  ) {
    const response = yield* treg.call({
      ...followersCall(handle, options.cursor),
      purpose: options.purpose,
    });
    const data = obj(obj(response.body).data);
    return {
      items: arr(data.followers).flatMap((row) => {
        const f = followerFromTikhub(obj(row));
        return f === null ? [] : [f];
      }),
      nextCursor: data.more_users === true ? str(data.next_cursor) || null : null,
      fromCache: response.cached,
    };
  });

  const trending = Effect.fn("XClient.trending")(function* (country: string, purpose: string) {
    const response = yield* treg.call({ ...trendingCall(country), purpose });
    return arr(obj(obj(response.body).data).trends).map((row): XTrend => {
      const t = obj(row);
      return { name: str(t.name), context: str(t.context) || null, postCount: num(t.tweet_count) };
    });
  });

  const own = (path: string, input: Omit<Treg.TregCall, "endpoint">) =>
    treg.call({ ...input, endpoint: `${ENDPOINTS.own}/${path}` });

  const meCall: Omit<Treg.TregCall, "endpoint"> = {
    query: { "user.fields": "id,name,username" },
    purpose: "",
    cacheFor: Duration.hours(24),
    expectedCostUsd: RATE_CARD.profile,
  };

  const me = Effect.fn("XClient.me")(function* (purpose: string) {
    const response = yield* own("2/users/me", { ...meCall, purpose }).pipe(
      Effect.catchTag("XApiError", (e) =>
        e.reason === "provider" ? Effect.succeed(null) : Effect.fail(e),
      ),
    );
    if (response === null) return null;
    const data = obj(obj(response.body).data);
    return str(data.id) === ""
      ? null
      : { userId: str(data.id), handle: str(data.username).toLowerCase(), name: str(data.name) };
  });

  const createPost = Effect.fn("XClient.createPost")(function* (input: CreatePostInput) {
    const response = yield* own("2/tweets", {
      method: "POST",
      body: {
        text: input.text,
        ...(input.replyToPostId === undefined
          ? {}
          : { reply: { in_reply_to_tweet_id: input.replyToPostId } }),
        ...(input.replySettings === undefined ? {} : { reply_settings: input.replySettings }),
        ...(input.poll === undefined
          ? {}
          : {
              poll: { options: input.poll.options, duration_minutes: input.poll.durationMinutes },
            }),
      },
      purpose: input.purpose,
      expectedCostUsd: postCostUsd(input.text),
    });
    return { postId: str(obj(obj(response.body).data).id), costUsd: response.costUsd };
  });

  const deletePost = Effect.fn("XClient.deletePost")(function* (postId: string, purpose: string) {
    yield* own(`2/tweets/${postId}`, {
      method: "DELETE",
      purpose,
      expectedCostUsd: RATE_CARD.delete,
    });
  });

  const requireUserId = (purpose: string) =>
    Effect.flatMap(me(purpose), (m) =>
      m === null
        ? Effect.fail(
            new XApiError({
              endpoint: ENDPOINTS.own,
              reason: "provider",
              status: null,
              detail: "no X account connected in treg; run `treg connections` and connect X",
            }),
          )
        : Effect.succeed(m.userId),
    );

  const like = Effect.fn("XClient.like")(function* (postId: string, purpose: string) {
    const id = yield* requireUserId(purpose);
    yield* own(`2/users/${id}/likes`, {
      method: "POST",
      body: { tweet_id: postId },
      purpose,
      expectedCostUsd: RATE_CARD.like,
    });
  });

  const repost = Effect.fn("XClient.repost")(function* (postId: string, purpose: string) {
    const id = yield* requireUserId(purpose);
    yield* own(`2/users/${id}/retweets`, {
      method: "POST",
      body: { tweet_id: postId },
      purpose,
      expectedCostUsd: RATE_CARD.repost,
    });
  });

  const sendDm = Effect.fn("XClient.sendDm")(function* (
    participantId: string,
    text: string,
    purpose: string,
  ) {
    yield* own(`2/dm_conversations/with/${participantId}/messages`, {
      method: "POST",
      body: { text },
      purpose,
      expectedCostUsd: RATE_CARD.dm,
    });
  });

  const mentionsCall = (userId: string, sinceId?: string): Treg.TregCall => ({
    endpoint: `${ENDPOINTS.own}/2/users/${userId}/mentions`,
    query: {
      "tweet.fields": "id,text,created_at,public_metrics,author_id,lang",
      expansions: "author_id",
      "user.fields": "id,name,username,public_metrics,verified",
      max_results: 50,
      since_id: sinceId,
    },
    purpose: "",
    cacheFor: Duration.minutes(5),
    expectedCostUsd: RATE_CARD.readPage,
  });

  const mentions = Effect.fn("XClient.mentions")(function* (options: {
    readonly sinceId?: string;
    readonly purpose: string;
  }) {
    const id = yield* requireUserId(options.purpose);
    const response = yield* treg.call({
      ...mentionsCall(id, options.sinceId),
      purpose: options.purpose,
    });
    const body = obj(response.body);
    const users = new Map(arr(obj(body.includes).users).map((u) => [str(obj(u).id), obj(u)]));
    return arr(body.data).flatMap((row): Array<XPost> => {
      const t = obj(row);
      const u = users.get(str(t.author_id)) ?? {};
      const m = obj(t.public_metrics);
      const handle = str(u.username).toLowerCase();
      const createdAt = isoFromText(str(t.created_at));
      if (str(t.id) === "" || createdAt === null) return [];
      return [
        {
          postId: str(t.id),
          url: `https://x.com/${handle}/status/${str(t.id)}`,
          text: str(t.text),
          createdAt,
          lang: str(t.lang) || null,
          isReply: true,
          isRepost: false,
          hasMedia: false,
          hasLink: hasLink(str(t.text)),
          author: {
            userId: str(t.author_id),
            handle,
            name: str(u.name) || handle,
            followers: num(obj(u.public_metrics).followers_count),
            verified: u.verified === true,
            avatarUrl: null,
          },
          metrics: {
            views: num(m.impression_count),
            likes: int(m.like_count),
            reposts: int(m.retweet_count),
            replies: int(m.reply_count),
            quotes: int(m.quote_count),
            bookmarks: int(m.bookmark_count),
          },
        },
      ];
    });
  });

  const cached: CacheProbes = {
    search: (query, mode) => treg.isCached(searchCall(query, mode === undefined ? {} : { mode })),
    profile: (handle) => treg.isCached(profileCall(handle)),
    userPosts: (handle) => treg.isCached(userPostsCall(handle)),
    followers: (handle) => treg.isCached(followersCall(handle)),
    trending: (country) => treg.isCached(trendingCall(country)),
    // The mentions key needs the user id, so a cold `me` means a cold mentions page too.
    mentions: Effect.gen(function* () {
      const meCached = yield* treg.isCached({ ...meCall, endpoint: `${ENDPOINTS.own}/2/users/me` });
      if (!meCached) return false;
      const m = yield* me("costs.quote").pipe(Effect.orElseSucceed(() => null));
      return m === null ? false : yield* treg.isCached(mentionsCall(m.userId));
    }),
  };

  return XClient.of({
    searchPosts,
    profile,
    userPosts,
    followers,
    trending,
    me,
    createPost,
    deletePost,
    like,
    repost,
    sendDm,
    mentions,
    cached,
  });
});

export const layer = Layer.effect(XClient, make).pipe(Layer.provide(Treg.layer));

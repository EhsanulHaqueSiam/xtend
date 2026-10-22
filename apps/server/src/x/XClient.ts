import {
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

/** X's prices, as treg bills them. Shown before any write and summed into the budget. */
const X_COST_USD = {
  post: 0.015,
  postWithLink: 0.2,
  like: 0.015,
  repost: 0.015,
  follow: 0.015,
  dm: 0.015,
  delete: 0.01,
  readPage: 0.005,
  profile: 0.01,
} as const;

const hasLink = (text: string) => /https?:\/\/\S+|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(text);
export const postCostUsd = (text: string) =>
  hasLink(text) ? X_COST_USD.postWithLink : X_COST_USD.post;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number => Math.max(0, Math.trunc(num(v) ?? 0));
const isoFromUtc = (seconds: unknown): string =>
  DateTime.formatIso(DateTime.makeUnsafe((num(seconds) ?? 0) * 1000));
// X's "Wed Oct 22 10:00:00 +0000 2026" form; DateTime parses it like Date does.
const isoFromText = (text: string): string | null =>
  DateTime.make(text).pipe((o) => (o._tag === "Some" ? DateTime.formatIso(o.value) : null));

const postFromAnyapi = (row: Json, fallbackHandle: string): XPost => {
  const text = str(row.text);
  const handle = str(row.authorUsername ?? row.authorHandle) || fallbackHandle;
  return {
    postId: str(row.id),
    url: str(row.url) || `https://x.com/${handle}/status/${str(row.id)}`,
    text,
    createdAt: isoFromUtc(row.createdUtc),
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
  handle: str(d.handle),
  name: str(d.displayName) || str(d.handle),
  bio: str(d.bio),
  followers: int(d.followers),
  following: int(d.following),
  posts: int(d.tweets),
  verified: d.verified === true,
  avatarUrl: str(d.avatarUrl).replace("_normal", "_400x400") || null,
  createdAt: num(d.createdUtc) === null ? null : isoFromUtc(d.createdUtc),
  location: str(d.location) || null,
  website: str(d.website) || null,
});

const followerFromTikhub = (row: Json): XFollower | null => {
  const legacy = obj(row.legacy);
  const handle = str(row.screen_name ?? legacy.screen_name);
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
  }
>()("xtend/x/XClient") {}

export const make = Effect.gen(function* () {
  const treg = yield* Treg.Treg;

  const searchPosts = Effect.fn("XClient.searchPosts")(function* (
    query: string,
    options: SearchOptions,
  ) {
    const response = yield* treg.call({
      endpoint: ENDPOINTS.searchPosts,
      body: {
        query,
        limit: options.limit ?? 20,
        queryType: options.mode === "latest" ? "Latest" : "Top",
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      purpose: options.purpose,
      cacheFor: Duration.minutes(30),
      expectedCostUsd: 0.00075,
    });
    const data = obj(obj(obj(response.body).output).data);
    return {
      items: arr(data.items)
        .map((row) => postFromAnyapi(obj(row), ""))
        .filter((p) => p.postId !== ""),
      nextCursor: str(data.nextCursor) || null,
    };
  });

  const profile = Effect.fn("XClient.profile")(function* (handle: string, purpose: string) {
    const response = yield* treg.call({
      endpoint: ENDPOINTS.profile,
      body: { handle: handle.replace(/^@/, "") },
      purpose,
      cacheFor: Duration.hours(6),
      expectedCostUsd: 0.00022,
    });
    const output = obj(obj(response.body).output);
    return output.found === true ? profileFromAnyapi(obj(output.data)) : null;
  });

  const userPosts = Effect.fn("XClient.userPosts")(function* (
    handle: string,
    options: { readonly cursor?: string; readonly purpose: string },
  ) {
    const clean = handle.replace(/^@/, "");
    const response = yield* treg.call({
      endpoint: ENDPOINTS.userPosts,
      body: { handle: clean, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) },
      purpose: options.purpose,
      cacheFor: Duration.hours(1),
      expectedCostUsd: 0.00075,
    });
    const data = obj(obj(obj(response.body).output).data);
    return {
      items: arr(data.tweets)
        .map((row) => postFromAnyapi(obj(row), clean))
        .filter((p) => p.postId !== ""),
      nextCursor: str(data.nextCursor) || null,
    };
  });

  const followers = Effect.fn("XClient.followers")(function* (
    handle: string,
    options: { readonly cursor?: string; readonly purpose: string },
  ) {
    const response = yield* treg.call({
      endpoint: ENDPOINTS.followers,
      query: { screen_name: handle.replace(/^@/, ""), cursor: options.cursor },
      purpose: options.purpose,
      cacheFor: Duration.hours(12),
      expectedCostUsd: 0.001,
    });
    const data = obj(obj(response.body).data);
    return {
      items: arr(data.followers).flatMap((row) => {
        const f = followerFromTikhub(obj(row));
        return f === null ? [] : [f];
      }),
      nextCursor: data.more_users === true ? str(data.next_cursor) || null : null,
    };
  });

  const trending = Effect.fn("XClient.trending")(function* (country: string, purpose: string) {
    const response = yield* treg.call({
      endpoint: ENDPOINTS.trending,
      query: { country },
      purpose,
      cacheFor: Duration.minutes(30),
      expectedCostUsd: 0.001,
    });
    return arr(obj(obj(response.body).data).trends).map((row): XTrend => {
      const t = obj(row);
      return { name: str(t.name), context: str(t.context) || null, postCount: num(t.tweet_count) };
    });
  });

  const own = (path: string, input: Omit<Treg.TregCall, "endpoint">) =>
    treg.call({ ...input, endpoint: `${ENDPOINTS.own}/${path}` });

  const me = Effect.fn("XClient.me")(function* (purpose: string) {
    const response = yield* own("2/users/me", {
      query: { "user.fields": "id,name,username" },
      purpose,
      cacheFor: Duration.hours(24),
      expectedCostUsd: X_COST_USD.profile,
    }).pipe(
      Effect.catchTag("XApiError", (e) =>
        e.reason === "provider" ? Effect.succeed(null) : Effect.fail(e),
      ),
    );
    if (response === null) return null;
    const data = obj(obj(response.body).data);
    return str(data.id) === ""
      ? null
      : { userId: str(data.id), handle: str(data.username), name: str(data.name) };
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
      expectedCostUsd: X_COST_USD.delete,
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
      expectedCostUsd: X_COST_USD.like,
    });
  });

  const repost = Effect.fn("XClient.repost")(function* (postId: string, purpose: string) {
    const id = yield* requireUserId(purpose);
    yield* own(`2/users/${id}/retweets`, {
      method: "POST",
      body: { tweet_id: postId },
      purpose,
      expectedCostUsd: X_COST_USD.repost,
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
      expectedCostUsd: X_COST_USD.dm,
    });
  });

  const mentions = Effect.fn("XClient.mentions")(function* (options: {
    readonly sinceId?: string;
    readonly purpose: string;
  }) {
    const id = yield* requireUserId(options.purpose);
    const response = yield* own(`2/users/${id}/mentions`, {
      query: {
        "tweet.fields": "id,text,created_at,public_metrics,author_id,lang",
        expansions: "author_id",
        "user.fields": "id,name,username,public_metrics,verified",
        max_results: 50,
        since_id: options.sinceId,
      },
      purpose: options.purpose,
      cacheFor: Duration.minutes(5),
      expectedCostUsd: X_COST_USD.readPage,
    });
    const body = obj(response.body);
    const users = new Map(arr(obj(body.includes).users).map((u) => [str(obj(u).id), obj(u)]));
    return arr(body.data).map((row): XPost => {
      const t = obj(row);
      const u = users.get(str(t.author_id)) ?? {};
      const m = obj(t.public_metrics);
      const handle = str(u.username);
      return {
        postId: str(t.id),
        url: `https://x.com/${handle}/status/${str(t.id)}`,
        text: str(t.text),
        createdAt: str(t.created_at),
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
      };
    });
  });

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
  });
});

export const layer = Layer.effect(XClient, make).pipe(Layer.provide(Treg.layer));

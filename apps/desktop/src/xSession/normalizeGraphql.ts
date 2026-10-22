import type { ObservationSource, ObservedPost } from "@xtend/contracts";

/**
 * Turns one X GraphQL response body into observed posts. X nests tweets
 * differently per surface and changes the shapes every few weeks, so this
 * walks the whole object for anything tweet-shaped instead of knowing the
 * path. Unknown shapes yield nothing rather than wrong numbers.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const asCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const asNullableCount = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

const X_ID = /^\d{1,25}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** "Wed Oct 22 04:00:00 +0000 2026" → ISO. Returns undefined for anything else. */
export function xDateToIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function readAuthor(tweet: Json): ObservedPost["author"] | undefined {
  const core = isRecord(tweet.core) ? tweet.core : undefined;
  const userResults = core && isRecord(core.user_results) ? core.user_results : undefined;
  const user = userResults && isRecord(userResults.result) ? userResults.result : undefined;
  if (user === undefined) return undefined;
  const legacy = isRecord(user.legacy) ? user.legacy : {};
  // 2025 moved handle and name from user.legacy to user.core; accept both.
  const userCore = isRecord(user.core) ? user.core : {};
  const userId = asString(user.rest_id);
  const handle = asString(userCore.screen_name) ?? asString(legacy.screen_name);
  const name = asString(userCore.name) ?? asString(legacy.name) ?? handle;
  if (
    userId === undefined ||
    !X_ID.test(userId) ||
    handle === undefined ||
    !X_HANDLE.test(handle)
  ) {
    return undefined;
  }
  return {
    userId,
    handle: handle.toLowerCase(),
    name: name ?? handle,
    followers: asNullableCount(legacy.followers_count),
    verified: user.is_blue_verified === true || legacy.verified === true,
  };
}

function readPost(tweet: Json, promoted: boolean): ObservedPost | undefined {
  const postId = asString(tweet.rest_id);
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : undefined;
  if (postId === undefined || !X_ID.test(postId) || legacy === undefined) return undefined;
  const author = readAuthor(tweet);
  const createdAt = xDateToIso(legacy.created_at);
  if (author === undefined || createdAt === undefined) return undefined;

  // Long posts carry the full text in note_tweet; legacy.full_text is truncated.
  const noteTweet = isRecord(tweet.note_tweet) ? tweet.note_tweet : undefined;
  const noteResults =
    noteTweet && isRecord(noteTweet.note_tweet_results) ? noteTweet.note_tweet_results : undefined;
  const note = noteResults && isRecord(noteResults.result) ? noteResults.result : undefined;
  const text = asString(note?.text) ?? asString(legacy.full_text) ?? "";

  const entities = isRecord(legacy.entities) ? legacy.entities : {};
  const extended = isRecord(legacy.extended_entities) ? legacy.extended_entities : {};
  const media = Array.isArray(extended.media)
    ? extended.media
    : Array.isArray(entities.media)
      ? entities.media
      : [];
  const urls = Array.isArray(entities.urls) ? entities.urls : [];
  const views = isRecord(tweet.views) ? tweet.views : {};

  return {
    postId,
    author,
    text,
    createdAt,
    isReply: typeof legacy.in_reply_to_status_id_str === "string",
    // A retweet is a wrapper whose author is the reposter; the original rides inside it and is read on its own.
    isRepost: isRecord(legacy.retweeted_status_result),
    isPromoted: promoted,
    hasMedia: media.length > 0,
    hasLink: urls.length > 0,
    metrics: {
      views: asNullableCount(views.count),
      likes: asCount(legacy.favorite_count),
      reposts: asCount(legacy.retweet_count),
      replies: asCount(legacy.reply_count),
      quotes: asCount(legacy.quote_count),
      bookmarks: asCount(legacy.bookmark_count),
    },
  };
}

export function normalizeGraphqlResponse(body: unknown): ReadonlyArray<ObservedPost> {
  const found = new Map<string, ObservedPost>();
  // An ad is marked on the timeline item (promotedMetadata), above the tweet; the flag travels down.
  const stack: Array<{ node: unknown; promoted: boolean }> = [{ node: body, promoted: false }];
  while (stack.length > 0) {
    const { node, promoted } = stack.pop()!;
    // Children are pushed in reverse so pops follow document order: timeline order is the feed order.
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], promoted });
      continue;
    }
    if (!isRecord(node)) continue;
    const inAd = promoted || isRecord(node.promotedMetadata);
    if (node.__typename === "Tweet") {
      const post = readPost(node, inAd);
      // The first sighting in a response is the outer post; a quoted copy of
      // the same id deeper down carries the same numbers.
      if (post !== undefined && !found.has(post.postId)) found.set(post.postId, post);
    }
    // TweetWithVisibilityResults wraps the tweet; quoted and retweeted posts nest inside legacy.
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) stack.push({ node: values[i], promoted: inAd });
  }
  return [...found.values()];
}

/** The logged-in handle, from the `Viewer` operation x.com runs on every load. */
export function readViewerHandle(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.viewer)) return undefined;
  const results = body.data.viewer.user_results;
  const user = isRecord(results) && isRecord(results.result) ? results.result : undefined;
  if (user === undefined) return undefined;
  const core = isRecord(user.core) ? user.core : {};
  const legacy = isRecord(user.legacy) ? user.legacy : {};
  const handle = asString(core.screen_name) ?? asString(legacy.screen_name);
  return handle !== undefined && X_HANDLE.test(handle) ? handle.toLowerCase() : undefined;
}

export const isViewerOperation = (url: string): boolean =>
  /\/i\/api\/graphql\/[^/]+\/Viewer(\?|$)/.test(url);

/** Which surface a GraphQL operation belongs to, from the operation name in its URL. */
export function sourceFromOperation(url: string): ObservationSource {
  const name = /\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)/.exec(url)?.[1] ?? "";
  if (/^Home(Latest)?Timeline$/.test(name)) return "home";
  if (/^User(Tweets|TweetsAndReplies|Media|HighlightsTweets)$/.test(name)) return "profile";
  if (name === "TweetDetail") return "detail";
  if (name === "SearchTimeline") return "search";
  if (/Notification/.test(name)) return "notifications";
  return "other";
}

export const isGraphqlUrl = (url: string): boolean => url.includes("/i/api/graphql/");

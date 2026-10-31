import type { EngineMedia, EnginePost, ObservationSource, ObservedPost } from "@xtend/contracts";

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
/** A count X sent as a number or a digit string (views always come as one); null for anything else. */
const asCount = (value: unknown): number | null => {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
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
  // The protected flag moved from user.legacy to user.privacy; unknown stays unknown, so the
  // pool (which shares only authors read as public) fails closed on a shape change.
  const privacy = isRecord(user.privacy) ? user.privacy : {};
  const isProtected =
    typeof privacy.protected === "boolean"
      ? privacy.protected
      : typeof legacy.protected === "boolean"
        ? legacy.protected
        : undefined;
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
    followers: asCount(legacy.followers_count),
    verified: user.is_blue_verified === true || legacy.verified === true,
    ...(isProtected === undefined ? {} : { isProtected }),
  };
}

function readPost(tweet: Json, promoted: boolean): ObservedPost | undefined {
  const postId = asString(tweet.rest_id);
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : undefined;
  if (postId === undefined || !X_ID.test(postId) || legacy === undefined) return undefined;
  const author = readAuthor(tweet);
  const createdAt = xDateToIso(legacy.created_at);
  const likes = asCount(legacy.favorite_count);
  const reposts = asCount(legacy.retweet_count);
  const replies = asCount(legacy.reply_count);
  const quotes = asCount(legacy.quote_count);
  // A renamed count would otherwise record as 0 and pass for a real drop; bookmark_count is newer and not always sent.
  if (
    author === undefined ||
    createdAt === undefined ||
    likes === null ||
    reposts === null ||
    replies === null ||
    quotes === null
  ) {
    return undefined;
  }

  // Long posts carry the full text in note_tweet; legacy.full_text is truncated.
  const noteTweet = isRecord(tweet.note_tweet) ? tweet.note_tweet : undefined;
  const noteResults =
    noteTweet && isRecord(noteTweet.note_tweet_results) ? noteTweet.note_tweet_results : undefined;
  const note = noteResults && isRecord(noteResults.result) ? noteResults.result : undefined;
  // X escapes &, < and > in post text as HTML would; &amp; goes last so "&amp;gt;" stays "&gt;".
  const text = (asString(note?.text) ?? asString(legacy.full_text) ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

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
      views: asCount(views.count),
      likes,
      reposts,
      replies,
      quotes,
      bookmarks: asCount(legacy.bookmark_count) ?? 0,
    },
  };
}

/** Every tweet-shaped object in a response, read by `read`, first sighting per id, in document order. */
function walkTweets<T extends { readonly postId: string }>(
  body: unknown,
  read: (tweet: Json, promoted: boolean) => T | undefined,
): ReadonlyArray<T> {
  const found = new Map<string, T>();
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
    // TweetWithVisibilityResults (limited replies, sensitive media) wraps a tweet that carries no __typename of its own.
    const tweet =
      node.__typename === "Tweet"
        ? node
        : node.__typename === "TweetWithVisibilityResults" && isRecord(node.tweet)
          ? node.tweet
          : undefined;
    if (tweet !== undefined) {
      const post = read(tweet, inAd);
      // The first sighting in a response is the outer post; a quoted copy of
      // the same id deeper down carries the same numbers.
      if (post !== undefined && !found.has(post.postId)) found.set(post.postId, post);
    }
    // Quoted and retweeted posts nest inside the tweet; a post quoted by an ad is not itself the ad.
    const childPromoted = inAd && tweet === undefined;
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--)
      stack.push({ node: values[i], promoted: childPromoted });
  }
  return [...found.values()];
}

export const normalizeGraphqlResponse = (body: unknown): ReadonlyArray<ObservedPost> =>
  walkTweets(body, readPost);

const asNumber = (value: unknown) => (typeof value === "number" ? value : 0);

function readMedia(item: unknown): EngineMedia | undefined {
  if (!isRecord(item)) return undefined;
  const url = asString(item.media_url_https);
  if (url === undefined) return undefined;
  const kind = item.type === "video" ? "video" : item.type === "animated_gif" ? "gif" : "photo";
  const info = isRecord(item.video_info) ? item.video_info : {};
  const variants = Array.isArray(info.variants) ? info.variants.filter(isRecord) : [];
  // The highest-bitrate mp4; X also lists an HLS playlist, which a plain <video> cannot play.
  const best = variants
    .filter((v) => v.content_type === "video/mp4")
    .sort((a, b) => asNumber(b.bitrate) - asNumber(a.bitrate))[0];
  const size = isRecord(item.original_info) ? item.original_info : {};
  return {
    kind,
    url,
    videoUrl: best === undefined ? null : (asString(best.url) ?? null),
    width: asNumber(size.width),
    height: asNumber(size.height),
  };
}

function readEnginePost(tweet: Json, promoted: boolean): EnginePost | undefined {
  const legacy = isRecord(tweet.legacy) ? tweet.legacy : {};
  // A repost wrapper is skipped: the original nests inside it and is read in its place.
  if (isRecord(legacy.retweeted_status_result)) return undefined;
  const post = readPost(tweet, promoted);
  if (post === undefined) return undefined;
  const core = isRecord(tweet.core) ? tweet.core : {};
  const results = isRecord(core.user_results) ? core.user_results : {};
  const user = isRecord(results.result) ? results.result : {};
  const avatar = isRecord(user.avatar) ? user.avatar : {};
  const userLegacy = isRecord(user.legacy) ? user.legacy : {};
  const extended = isRecord(legacy.extended_entities) ? legacy.extended_entities : {};
  return {
    ...post,
    avatarUrl: asString(avatar.image_url) ?? asString(userLegacy.profile_image_url_https) ?? null,
    media: (Array.isArray(extended.media) ? extended.media : []).flatMap((m) => readMedia(m) ?? []),
    quotedId: asString(legacy.quoted_status_id_str) ?? null,
    replyToId: asString(legacy.in_reply_to_status_id_str) ?? null,
  };
}

/** Posts as Xtend's own X screens draw them, in the response's order. */
export const renderPostsFromGraphql = (body: unknown): ReadonlyArray<EnginePost> =>
  walkTweets(body, readEnginePost);

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

/** The composer's own writes, a post and a long post; their responses carry the new post. */
export const isCreateTweetOperation = (url: string): boolean =>
  /\/i\/api\/graphql\/[^/]+\/Create(Note)?Tweet(\?|$)/.test(url);

/**
 * The id of the post a CreateTweet or CreateNoteTweet response created, read from its fixed
 * path: X sends that result without the `__typename` the walk looks for.
 */
export function readCreatedPostId(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.data)) return undefined;
  const created = body.data.create_tweet ?? body.data.notetweet_create;
  const results = isRecord(created) ? created.tweet_results : undefined;
  const result = isRecord(results) && isRecord(results.result) ? results.result : undefined;
  // A post with limited replies comes back in the visibility wrapper.
  const id =
    asString(result?.rest_id) ??
    asString(isRecord(result?.tweet) ? result.tweet.rest_id : undefined);
  return id !== undefined && X_ID.test(id) ? id : undefined;
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

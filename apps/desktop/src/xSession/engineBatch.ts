import type {
  EngineBatch,
  EngineCard,
  EngineEntities,
  EngineRange,
  EngineExploreTab,
  EngineHomeTab,
  EngineLink,
  EngineList,
  EngineMedia,
  EngineNotification,
  EnginePoll,
  EnginePost,
  EngineTrend,
  EngineUser,
} from "@xtend/contracts";

import {
  asCount,
  asString,
  isRecord,
  type Json,
  readPost,
  type WalkContext,
  walkTweets,
  X_HANDLE,
  X_ID,
  xDateToIso,
} from "./normalizeGraphql.ts";

/**
 * Turns one X GraphQL response into what Xtend's own X screens draw: posts with everything X
 * shows on them, and the people, trends, notifications, Lists and tabs around them. Like the
 * observation normalizer, it reads by shape rather than by path and yields nothing for shapes it
 * does not know.
 */

const record = (value: unknown): Json => (isRecord(value) ? value : {});
const asNumber = (value: unknown) => (typeof value === "number" ? value : 0);
const result = (value: unknown) => record(record(value).result);
const arr = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

function readMedia(item: unknown): EngineMedia | undefined {
  if (!isRecord(item)) return undefined;
  const url = asString(item.media_url_https);
  if (url === undefined) return undefined;
  const kind = item.type === "video" ? "video" : item.type === "animated_gif" ? "gif" : "photo";
  const variants = arr(record(item.video_info).variants).filter(isRecord);
  // The highest-bitrate mp4; X also lists an HLS playlist, which a plain <video> cannot play.
  const best = variants
    .filter((v) => v.content_type === "video/mp4")
    .sort((a, b) => asNumber(b.bitrate) - asNumber(a.bitrate))[0];
  const size = record(item.original_info);
  return {
    kind,
    url,
    videoUrl: best === undefined ? null : (asString(best.url) ?? null),
    width: asNumber(size.width),
    height: asNumber(size.height),
  };
}

/** A card's binding values by key: `{ key, value: { string_value | image_value | boolean_value } }`. */
function bindings(card: Json): ReadonlyMap<string, Json> {
  return new Map(
    arr(record(card.legacy).binding_values).flatMap((b) =>
      isRecord(b) && typeof b.key === "string" ? [[b.key, record(b.value)] as const] : [],
    ),
  );
}

const POLL = /^poll\dchoice/;

function readPoll(card: Json): EnginePoll | null {
  if (!POLL.test(asString(record(card.legacy).name) ?? "")) return null;
  const b = bindings(card);
  const choices = [1, 2, 3, 4].flatMap((n) => {
    const label = asString(b.get(`choice${n}_label`)?.string_value);
    return label === undefined
      ? []
      : [{ label, votes: asCount(b.get(`choice${n}_count`)?.string_value) ?? 0 }];
  });
  if (choices.length === 0) return null;
  const voted = asCount(b.get("selected_choice")?.string_value);
  return {
    choices,
    endsAt: xDateToIso(b.get("end_datetime_utc")?.string_value) ?? null,
    final: b.get("counts_are_final")?.boolean_value === true,
    voted: voted === null || voted === 0 ? null : voted,
  };
}

const imageOf = (value: Json | undefined) => asString(record(value?.image_value).url) ?? null;

function readCard(
  tweet: Json,
  links: ReadonlyArray<Omit<EngineLink, "indices">>,
): EngineCard | null {
  const article = result(record(tweet.article).article_results);
  const articleId = asString(article.rest_id);
  if (articleId !== undefined && X_ID.test(articleId)) {
    return {
      kind: "article",
      url: `https://x.com/i/article/${articleId}`,
      title: asString(article.title) ?? "",
      domain: null,
      description: asString(article.preview_text) ?? null,
      imageUrl: asString(record(record(article.cover_media).media_info).original_img_url) ?? null,
    };
  }
  const card = record(tweet.card);
  const name = asString(record(card.legacy).name) ?? "";
  if (name === "" || POLL.test(name)) return null;
  const b = bindings(card);
  if (name === "unified_card") return readUnifiedCard(b.get("unified_card")?.string_value);
  const title = asString(b.get("title")?.string_value);
  if (title === undefined) return null;
  // card_url is the t.co X put in the text; the post's own entities say where it really goes.
  const short = asString(b.get("card_url")?.string_value) ?? "";
  return {
    kind: "link",
    url: links.find((l) => l.url === short)?.expanded ?? short,
    title,
    domain:
      asString(b.get("vanity_url")?.string_value) ??
      asString(b.get("domain")?.string_value) ??
      null,
    description: asString(b.get("description")?.string_value) ?? null,
    imageUrl:
      imageOf(b.get("photo_image_full_size_large")) ??
      imageOf(b.get("summary_photo_image_large")) ??
      imageOf(b.get("thumbnail_image_large")) ??
      imageOf(b.get("thumbnail_image")),
  };
}

/** X's newer cards: a JSON string of components (details, media) pointing at a destination. */
function readUnifiedCard(raw: unknown): EngineCard | null {
  let card: Json;
  try {
    card = record(JSON.parse(typeof raw === "string" ? raw : ""));
  } catch {
    return null;
  }
  const components = Object.values(record(card.component_objects)).filter(isRecord);
  const details = record(components.find((c) => c.type === "details")?.data);
  const title = asString(record(details.title).content);
  if (title === undefined) return null;
  const destination = record(record(card.destination_objects)[asString(details.destination) ?? ""]);
  const urlData = record(record(destination.data).url_data);
  const media = Object.values(record(card.media_entities)).find(isRecord);
  const url = asString(urlData.url);
  if (url === undefined) return null;
  return {
    kind: "link",
    url,
    title,
    domain: asString(record(details.subtitle).content) ?? asString(urlData.vanity) ?? null,
    description: null,
    imageUrl: asString(media?.media_url_https) ?? null,
  };
}

/** A post's entities as X lists them: a long post's live with its full text in note_tweet. */
function entitySource(tweet: Json, legacy: Json): Json {
  const note = result(record(tweet.note_tweet).note_tweet_results);
  return isRecord(note.entity_set) ? note.entity_set : record(legacy.entities);
}

function readLinks(source: Json): ReadonlyArray<Omit<EngineLink, "indices">> {
  return arr(source.urls).flatMap((u) => {
    const url = asString(record(u).url);
    const expanded = asString(record(u).expanded_url);
    const display = asString(record(u).display_url);
    return url === undefined || expanded === undefined
      ? []
      : [{ url, expanded, display: display ?? expanded }];
  });
}

/**
 * Where each entity sits in the shown text, found by its own text in order: X's indices count
 * code points in the raw text, which the shown text has trimmed and unescaped. One the shown text
 * no longer holds (a "Replying to" handle, a link drawn as the card) has no place.
 */
function readEntities(
  source: Json,
  links: ReadonlyArray<Omit<EngineLink, "indices">>,
  text: string,
): EngineEntities {
  const lower = text.toLowerCase();
  const place = (needles: ReadonlyArray<string>) => {
    let from = 0;
    return needles.map((needle): EngineRange | null => {
      const at = lower.indexOf(needle.toLowerCase(), from);
      if (at === -1) return null;
      from = at + needle.length;
      return [at, at + needle.length];
    });
  };
  const found = (items: ReadonlyArray<unknown>, field: string, mark: string) => {
    const names = items.flatMap((i) => asString(record(i)[field]) ?? []);
    const at = place(names.map((n) => mark + n));
    return names.flatMap((name, i) => {
      const indices = at[i];
      return indices === null || indices === undefined ? [] : [{ name, indices }];
    });
  };
  const linkAt = place(links.map((l) => l.url));
  return {
    urls: links.map((l, i) => ({ ...l, indices: linkAt[i] ?? null })),
    mentions: found(arr(source.user_mentions), "screen_name", "@").map(({ name, indices }) => ({
      handle: name.toLowerCase(),
      indices,
    })),
    hashtags: found(arr(source.hashtags), "text", "#").map(({ name, indices }) => ({
      tag: name,
      indices,
    })),
    cashtags: found(arr(source.symbols), "text", "$").map(({ name, indices }) => ({
      tag: name,
      indices,
    })),
  };
}

/** The post's edit history: every version's id, oldest first, and what X still allows. */
function readEdits(tweet: Json) {
  const control = record(tweet.edit_control);
  const chain = isRecord(control.edit_control_initial) ? control.edit_control_initial : control;
  const until = asString(chain.editable_until_msecs);
  return {
    edits: arr(chain.edit_tweet_ids).flatMap((id) =>
      typeof id === "string" && X_ID.test(id) ? [id] : [],
    ),
    editsRemaining: asCount(chain.edits_remaining),
    editableUntil:
      until !== undefined && /^\d+$/.test(until) ? new Date(Number(until)).toISOString() : null,
  };
}

/**
 * The handles X moves out of a reply's text into "Replying to": mentions that start before the
 * displayed range.
 */
function readReplyingTo(legacy: Json): ReadonlyArray<string> {
  const start = asNumber(arr(legacy.display_text_range)[0]);
  return arr(record(legacy.entities).user_mentions).flatMap((m) => {
    const handle = asString(record(m).screen_name);
    const at = asNumber(arr(record(m).indices)[0] ?? Infinity);
    return handle !== undefined && X_HANDLE.test(handle) && at < start
      ? [handle.toLowerCase()]
      : [];
  });
}

/**
 * The text as X shows it: without the leading "@a @b " X draws as "Replying to", and without the
 * trailing t.co links X draws as the media, the quote or the card.
 */
function shownText(text: string, replyingTo: ReadonlyArray<string>, hidden: ReadonlySet<string>) {
  let shown = text;
  if (replyingTo.length > 0) {
    const names = new Set(replyingTo);
    for (;;) {
      const lead = /^@([A-Za-z0-9_]{1,15})\s*/.exec(shown);
      if (lead === null || !names.has(lead[1]!.toLowerCase())) break;
      shown = shown.slice(lead[0].length);
    }
  }
  for (;;) {
    const tail = /\s*(https:\/\/t\.co\/\w+)\s*$/.exec(shown);
    if (tail === null || !hidden.has(tail[1]!)) break;
    shown = shown.slice(0, tail.index);
  }
  return shown;
}

function readEnginePost(
  tweet: Json,
  promoted: boolean,
  context: WalkContext | null,
): EnginePost | undefined {
  const legacy = record(tweet.legacy);
  // A repost wrapper is skipped: the original nests inside it and is read in its place.
  if (isRecord(legacy.retweeted_status_result)) return undefined;
  const post = readPost(tweet, promoted);
  if (post === undefined) return undefined;
  const user = result(record(tweet.core).user_results);
  const extended = record(legacy.extended_entities);
  const mediaItems = arr(extended.media);
  const source = entitySource(tweet, legacy);
  const links = readLinks(source);
  const card = readCard(tweet, links);
  const replyingTo = readReplyingTo(legacy);
  const hidden = new Set(
    [
      ...mediaItems.map((m) => asString(record(m).url)),
      asString(record(legacy.quoted_status_permalink).url),
      ...(card === null ? [] : links.filter((l) => l.expanded === card.url).map((l) => l.url)),
      asString(bindings(record(tweet.card)).get("card_url")?.string_value),
    ].filter((u) => u !== undefined),
  );
  const text = shownText(post.text, replyingTo, hidden);
  return {
    ...post,
    text,
    avatarUrl:
      asString(record(user.avatar).image_url) ??
      asString(record(user.legacy).profile_image_url_https) ??
      null,
    media: mediaItems.flatMap((m) => readMedia(m) ?? []),
    quotedId: asString(legacy.quoted_status_id_str) ?? null,
    replyToId: asString(legacy.in_reply_to_status_id_str) ?? null,
    replyingTo,
    entities: readEntities(source, links, text),
    card,
    poll: readPoll(record(tweet.card)),
    note: asString(record(record(tweet.birdwatch_pivot).subtitle).text) ?? null,
    context,
    liked: legacy.favorited === true,
    reposted: legacy.retweeted === true,
    bookmarked: legacy.bookmarked === true,
    // Filled in by the batch, which sees the timeline's modules.
    conversation: null,
    ...readEdits(tweet),
  };
}

/** Posts as Xtend's own X screens draw them, in the response's order. */
const renderPostsFromGraphql = (body: unknown): ReadonlyArray<EnginePost> =>
  walkTweets(body, readEnginePost);

/** A person in either of X's user shapes: the older `legacy` block or the 2026 split fields. */
function readUser(value: unknown): EngineUser | undefined {
  const user = record(value);
  const legacy = record(user.legacy);
  const core = record(user.core);
  const userId = asString(user.rest_id);
  const handle = asString(core.screen_name) ?? asString(legacy.screen_name);
  if (userId === undefined || !X_ID.test(userId) || handle === undefined || !X_HANDLE.test(handle))
    return undefined;
  const counts = record(user.relationship_counts);
  const tweets = record(user.tweet_counts);
  const perspective = record(user.relationship_perspectives);
  const bio = record(user.profile_bio);
  const site = [
    ...arr(record(record(bio.entities).url).urls),
    ...arr(record(record(legacy.entities).url).urls),
  ].map(record)[0];
  const siteUrl = asString(site?.expanded_url);
  const pinned = arr(record(user.pinned_items).tweet_ids_str ?? legacy.pinned_tweet_ids_str);
  const privacy = record(user.privacy);
  const flag = (a: unknown, b: unknown) => (typeof a === "boolean" ? a : b === true);
  return {
    userId,
    handle: handle.toLowerCase(),
    name: asString(core.name) ?? asString(legacy.name) ?? handle,
    avatarUrl:
      asString(record(user.avatar).image_url) ?? asString(legacy.profile_image_url_https) ?? null,
    bannerUrl:
      asString(record(user.banner).image_url) ?? asString(legacy.profile_banner_url) ?? null,
    bio: asString(bio.description) ?? asString(legacy.description) ?? "",
    location: asString(record(user.location).location) ?? asString(legacy.location) ?? null,
    website:
      siteUrl === undefined
        ? null
        : { url: siteUrl, display: asString(site?.display_url) ?? siteUrl },
    joinedAt: xDateToIso(core.created_at ?? legacy.created_at) ?? null,
    followers: asCount(counts.followers) ?? asCount(legacy.followers_count),
    following: asCount(counts.following) ?? asCount(legacy.friends_count),
    posts: asCount(tweets.tweets) ?? asCount(legacy.statuses_count),
    verified:
      user.is_blue_verified === true ||
      record(user.verification).verified === true ||
      legacy.verified === true,
    isProtected: flag(privacy.protected, legacy.protected),
    youFollow: flag(perspective.following, legacy.following),
    followsYou: flag(perspective.followed_by, legacy.followed_by),
    pinnedPostId: asString(pinned[0]) ?? null,
  };
}

const miniUser = (value: unknown) => {
  const u = readUser(value);
  return u === undefined
    ? []
    : [{ userId: u.userId, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl }];
};

/** X's app links (twitter://search/?query=...) as the x.com page they open. */
function trendUrl(raw: string | undefined, name: string): string {
  const fallback = `https://x.com/search?q=${encodeURIComponent(name)}`;
  if (raw === undefined) return fallback;
  if (raw.startsWith("https://")) return raw;
  const search = /^twitter:\/\/search\/?\?(.*)$/.exec(raw);
  if (search !== null) {
    const q = new URLSearchParams(search[1]).get("query");
    return q === null
      ? fallback
      : `https://x.com/search?q=${encodeURIComponent(q)}&src=trend_click`;
  }
  const trending = /^twitter:\/\/trending\/(\d{1,25})$/.exec(raw);
  return trending === null ? fallback : `https://x.com/i/trending/${trending[1]}`;
}

function readTrend(item: Json, group: string | null): EngineTrend | undefined {
  const name = asString(item.name);
  if (name === undefined) return undefined;
  const meta = record(item.trend_metadata);
  const social = record(item.social_context);
  return {
    name,
    context: asString(meta.domain_context) ?? asString(social.text) ?? null,
    url: trendUrl(asString(record(item.trend_url).url) ?? asString(record(meta.url).url), name),
    images: arr(social.contextImageUrls).filter((u) => typeof u === "string"),
    group,
  };
}

const tweetId = (value: unknown) => {
  const r = result(record(value).tweet_results);
  const id = asString(r.rest_id) ?? asString(record(r.tweet).rest_id);
  return id !== undefined && X_ID.test(id) ? [id] : [];
};

function readNotification(item: Json): EngineNotification | undefined {
  const id = asString(item.id);
  if (id === undefined) return undefined;
  const template = record(item.template);
  const ts = asString(item.timestamp_ms);
  return {
    id,
    kind: "event",
    icon: asString(item.notification_icon) ?? "",
    text: asString(record(item.rich_message).text) ?? "",
    // X sends the time as an ISO string under a name that promises milliseconds.
    at:
      ts === undefined
        ? null
        : /^\d+$/.test(ts)
          ? new Date(Number(ts)).toISOString()
          : (xDateToIso(ts) ?? null),
    users: arr(template.from_users).flatMap((u) => miniUser(record(record(u).user_results).result)),
    postIds: arr(template.target_objects).flatMap(tweetId),
  };
}

function readList(item: Json, group: string | null): EngineList | undefined {
  const list = record(item.list);
  const listId = asString(list.id_str);
  const name = asString(list.name);
  if (listId === undefined || !X_ID.test(listId) || name === undefined) return undefined;
  const banner = (m: unknown) =>
    asString(record(record(m).media_info).original_img_url) ?? undefined;
  return {
    listId,
    name,
    description: asString(list.description) ?? "",
    members: asCount(list.member_count),
    followers: asCount(list.subscriber_count),
    isPrivate: list.mode === "Private",
    bannerUrl: banner(list.custom_banner_media) ?? banner(list.default_banner_media) ?? null,
    owner: miniUser(record(list.user_results).result)[0] ?? null,
    group,
  };
}

function readHomeTabs(body: Json): ReadonlyArray<EngineHomeTab> | null {
  const pinned = record(record(body.data).pinned_timelines).pinned_timelines;
  if (!Array.isArray(pinned)) return null;
  return pinned.filter(isRecord).flatMap((t): ReadonlyArray<EngineHomeTab> => {
    if (t.__typename === "TagPinnedTimeline") {
      const tag = asString(t.tag);
      const label = asString(t.tab_label) ?? asString(t.name);
      return tag === undefined || label === undefined ? [] : [{ id: `tag:${tag}`, label }];
    }
    // A Community or a List, under whichever results key X used.
    const target = result(t.community_results ?? t.list_results ?? { result: t.list });
    const id = asString(target.id_str) ?? asString(target.rest_id);
    const label = asString(target.name);
    if (id === undefined || !X_ID.test(id) || label === undefined) return [];
    return [
      { id: t.__typename === "CommunityPinnedTimeline" ? `community:${id}` : `list:${id}`, label },
    ];
  });
}

function readExploreTabs(body: Json): ReadonlyArray<EngineExploreTab> | null {
  const tabs = record(record(record(body.data).explore_page).body).timelines;
  if (!Array.isArray(tabs)) return null;
  return tabs.filter(isRecord).flatMap((t) => {
    const id = asString(t.id);
    const label = asString(t.labelText);
    const timelineId = asString(record(t.timeline).id);
    return id === undefined || label === undefined || timelineId === undefined
      ? []
      : [{ id, label, timelineId }];
  });
}

/**
 * The request's variables, from the URL of a GET or the body of a POST (X sends HomeTimeline as
 * a POST). Unknown or unreadable variables are empty.
 */
export function requestVariables(url: string, postData: string | undefined): Json {
  try {
    const raw = new URL(url).searchParams.get("variables");
    if (raw !== null) return record(JSON.parse(raw));
    return record(record(JSON.parse(postData ?? "")).variables);
  } catch {
    return {};
  }
}

/** What one operation's request asked for, when the operation serves many pages. */
function keyOf(op: string, variables: Json, exploreTabs: ReadonlyArray<EngineExploreTab> | null) {
  const s = (k: string) => asString(variables[k]);
  if (op === "HomeTimeline") return s("tag") === undefined ? null : `tag:${s("tag")}`;
  if (op === "CommunityTweetsTimeline")
    return s("communityId") === undefined ? null : `community:${s("communityId")}`;
  if (op.startsWith("List") && s("listId") !== undefined) return `list:${s("listId")}`;
  if (op === "NotificationsTimeline") return s("timeline_type") ?? null;
  if (op === "GenericTimelineById") return s("timelineId") ?? null;
  // Explore's first page is its "for_you" tab, fetched by another name.
  if (op === "ExplorePage") return exploreTabs?.find((t) => t.id === "for_you")?.timelineId ?? null;
  if (op === "SearchTimeline")
    return s("product") === undefined || s("rawQuery") === undefined
      ? null
      : `${s("product")}:${s("rawQuery")}`;
  if (op === "TweetDetail") return s("focalTweetId") ?? null;
  if (op === "UserByScreenName") return s("screen_name")?.toLowerCase() ?? null;
  return s("userId") ?? null;
}

/**
 * Everything in one response for the engine's screens. People are the ones X lists (search
 * People, Who to follow, a profile's own header), not every post's author.
 */
export function renderEngineBatch(op: string, variables: Json, body: unknown): EngineBatch {
  const people: Array<string> = [];
  const conversations = new Map<string, NonNullable<EnginePost["conversation"]>>();
  const trends: Array<EngineTrend> = [];
  const notifications: Array<EngineNotification> = [];
  const lists: Array<EngineList> = [];
  let top: string | null = null;
  let bottom: string | null = null;
  // Depth first in document order, each node with the header of the module it sits in.
  const stack: Array<{ node: unknown; group: string | null }> = [{ node: body, group: null }];
  while (stack.length > 0) {
    const { node, group } = stack.pop()!;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], group });
      continue;
    }
    if (!isRecord(node)) continue;
    const type = node.itemType;
    if (type === "TimelineUser") {
      const user = readUser(record(node.user_results).result);
      if (user !== undefined && !people.includes(user.userId)) people.push(user.userId);
    } else if (
      typeof node.entryId === "string" &&
      record(node.content).displayType === "VerticalConversation"
    ) {
      // A self-thread or a reply under its parent, which X draws joined by a line.
      const module = node.entryId;
      const ids = arr(record(node.content).items).flatMap((item) =>
        tweetId(record(record(item).item).itemContent),
      );
      ids.forEach((id, index) => conversations.set(id, { id: module, index, size: ids.length }));
    } else if (type === "TimelineTrend") {
      const trend = readTrend(node, group);
      if (trend !== undefined) trends.push(trend);
    } else if (type === "TimelineNotification") {
      const n = readNotification(node);
      if (n !== undefined) notifications.push(n);
    } else if (type === "TimelineTweet" && op === "NotificationsTimeline") {
      // A reply or a mention is a notification that is the post itself.
      for (const id of tweetId(node))
        notifications.push({
          id: `post-${id}`,
          kind: "post",
          icon: "",
          text: "",
          at: null,
          users: [],
          postIds: [id],
        });
    } else if (type === "TimelineTwitterList") {
      const list = readList(node, group);
      if (list !== undefined) lists.push(list);
    } else if (node.cursorType === "Top" || node.cursorType === "Bottom") {
      const value = asString(node.value) ?? null;
      if (node.cursorType === "Top") top ??= value;
      else bottom ??= value;
    }
    // Tweets carry no people, trends or Lists worth listing; their insides are read by the post walk.
    if (node.__typename === "Tweet" || type === "TimelineNotification") continue;
    const header = asString(record(node.header).text);
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--)
      stack.push({ node: values[i], group: header ?? group });
  }
  const data = record(record(body).data);
  // A List's own page names it in its header.
  if (op === "ListByRestId") {
    const list = readList({ list: data.list }, null);
    if (list !== undefined) lists.push(list);
  }
  const exploreTabs = readExploreTabs(record(body));
  return {
    op,
    key: keyOf(op, variables, exploreTabs),
    cursor: asString(variables.cursor) ?? null,
    top,
    bottom,
    posts: renderPostsFromGraphql(body).map((p) => {
      const conversation = conversations.get(p.postId);
      return conversation === undefined ? p : { ...p, conversation };
    }),
    users: readUsers(body),
    people,
    trends,
    notifications,
    lists,
    homeTabs: readHomeTabs(record(body)),
    exploreTabs,
  };
}

/** Everyone a response names, in either user shape, first sighting per id. */
function readUsers(body: unknown): ReadonlyArray<EngineUser> {
  const found = new Map<string, EngineUser>();
  const stack: Array<unknown> = [body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (!isRecord(node)) continue;
    if (
      node.__typename === "User" &&
      typeof node.rest_id === "string" &&
      !found.has(node.rest_id)
    ) {
      const user = readUser(node);
      if (user !== undefined) found.set(user.userId, user);
    }
    const values = Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
  }
  return [...found.values()];
}

/** Whether a batch carries anything a screen draws; X's many housekeeping calls carry nothing. */
export const hasEngineContent = (b: EngineBatch) =>
  b.posts.length > 0 ||
  b.users.length > 0 ||
  b.trends.length > 0 ||
  b.notifications.length > 0 ||
  b.lists.length > 0 ||
  b.homeTabs !== null ||
  b.exploreTabs !== null;

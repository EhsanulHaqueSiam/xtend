import type {
  EngineAccountAnalytics,
  EngineArticle,
  EngineArticleBlock,
  EngineRecord,
  EngineBatch,
  EngineBookmarkFolder,
  EngineCard,
  EngineCommunity,
  EngineEntities,
  EngineRange,
  EngineExploreTab,
  EngineFolderChange,
  EngineGame,
  EngineGameTeam,
  EngineGif,
  EngineHomeTab,
  EngineLink,
  EngineList,
  EngineMedia,
  EngineModule,
  EngineNotification,
  EnginePeopleSection,
  EnginePoll,
  EnginePost,
  EnginePrompt,
  EngineRadarCount,
  EngineRadarQuery,
  EngineTrend,
  EngineUser,
  EngineViewer,
  TextStyle,
} from "@xtend/contracts";

import {
  asCount,
  asString,
  isRecord,
  type Json,
  readCreatedTweet,
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
    durationMs: asCount(record(item.video_info).duration_millis),
    altText: asString(item.ext_alt_text) ?? null,
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

/**
 * An X Article's body, which X sends only on its reader page: the Draft.js blocks of its
 * `content_state`, each block's entities resolved to links, the Article's own images (by media id)
 * and Markdown. An entity of another kind leaves its block's text as it is.
 */
function readArticle(tweet: Json): EngineArticle | undefined {
  const postId = asString(tweet.rest_id);
  const article = result(record(tweet.article).article_results);
  const state = record(article.content_state);
  if (postId === undefined || !X_ID.test(postId) || !Array.isArray(state.blocks)) return undefined;
  const images = new Map(
    arr(article.media_entities).flatMap((m) => {
      const id = asString(record(m).media_id);
      const info = record(record(m).media_info);
      const url = asString(info.original_img_url);
      return id === undefined || url === undefined
        ? []
        : [
            [
              id,
              {
                url,
                width: asNumber(info.original_img_width),
                height: asNumber(info.original_img_height),
              },
            ] as const,
          ];
    }),
  );
  // X sends the entity map as a list of `{ key, value }`.
  const entities = new Map(
    arr(state.entityMap).flatMap((e) => {
      const key = record(e).key;
      return typeof key === "string" || typeof key === "number"
        ? [[String(key), record(record(e).value)] as const]
        : [];
    }),
  );
  const span = (r: Json) => ({ offset: asNumber(r.offset), length: asNumber(r.length) });
  const blocks = state.blocks.filter(isRecord).map((block, i): EngineArticleBlock => {
    const used = arr(block.entityRanges).flatMap((r) => {
      const entity = entities.get(String(record(r).key));
      return entity === undefined ? [] : [{ range: record(r), entity, data: record(entity.data) }];
    });
    return {
      key: asString(block.key) ?? String(i),
      type: asString(block.type) ?? "unstyled",
      text: asString(block.text) ?? "",
      styles: arr(block.inlineStyleRanges).flatMap((r) => {
        const style = asString(record(r).style);
        return style === undefined ? [] : [{ ...span(record(r)), style }];
      }),
      links: used.flatMap(({ range, entity, data }) => {
        const url = asString(data.url);
        return entity.type === "LINK" && url !== undefined && /^https?:\/\//i.test(url)
          ? [{ ...span(range), url }]
          : [];
      }),
      images: used.flatMap(({ entity, data }) =>
        entity.type === "MEDIA"
          ? arr(data.mediaItems).flatMap((i) => images.get(asString(record(i).mediaId) ?? "") ?? [])
          : [],
      ),
      markdown:
        used.flatMap(({ entity, data }) =>
          entity.type === "MARKDOWN" ? (asString(data.markdown) ?? []) : [],
        )[0] ?? null,
    };
  });
  return { postId, blocks };
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
  const styles = readStyles(tweet, post.text, text);
  return {
    ...(styles.length === 0 ? {} : { styles }),
    translation: readTranslation(tweet, replyingTo, hidden),
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
    aiGenerated:
      record(record(tweet.content_disclosure).ai_generated_disclosure).has_ai_generated_media ===
      true,
  };
}

/**
 * A long post's bold and italic (X's `richtext_tags`), moved onto the shown text: X counts them in
 * UTF-16 units of the whole text, which the shown text may start into ("Replying to" handles).
 */
function readStyles(tweet: Json, full: string, shown: string): ReadonlyArray<TextStyle> {
  const lead = Math.max(0, full.indexOf(shown));
  return arr(
    record(result(record(tweet.note_tweet).note_tweet_results).richtext).richtext_tags,
  ).flatMap((tag) => {
    const from = asNumber(record(tag).from_index) - lead;
    const to = Math.min(asNumber(record(tag).to_index) - lead, shown.length);
    return arr(record(tag).richtext_types).flatMap((style) =>
      (style === "Bold" || style === "Italic") && Math.max(0, from) < to
        ? [{ start: Math.max(0, from), end: to, style }]
        : [],
    );
  });
}

/** X's Grok translation of a post, trimmed the way the original's text is. */
function readTranslation(
  tweet: Json,
  replyingTo: ReadonlyArray<string>,
  hidden: ReadonlySet<string>,
): EnginePost["translation"] {
  const data = record(record(tweet.grok_translated_post_with_availability).data);
  const translated = asString(data.translation);
  const from = asString(data.source_language);
  if (translated === undefined || translated === "" || from === undefined) return null;
  const source = record(data.entities);
  const text = shownText(translated, replyingTo, hidden);
  return { text, entities: readEntities(source, readLinks(source), text), from };
}

/** Posts as Xtend's own X screens draw them, in the response's order. */
const renderPostsFromGraphql = (body: unknown): ReadonlyArray<EnginePost> =>
  walkTweets(body, readEnginePost);

function readAffiliate(label: Json): EngineUser["affiliate"] {
  const name = asString(label.description);
  if (name === undefined) return null;
  const url = asString(record(label.url).url);
  return {
    name,
    badgeUrl: asString(record(label.badge).url) ?? null,
    url: url?.startsWith("https://") === true ? url : null,
  };
}

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
    verifiedType:
      asString(record(user.verification).verified_type) ?? asString(legacy.verified_type) ?? null,
    avatarShape: asString(user.profile_image_shape) ?? "Circle",
    affiliate: readAffiliate(record(record(user.affiliates_highlighted_label).label)),
    // X's word that the creator offers Subscriptions, only where this response says it.
    ...(typeof user.super_follow_eligible === "boolean"
      ? { offersSubscriptions: user.super_follow_eligible }
      : {}),
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

/** The post a timeline entry lists: a repost's original, as the posts walk reads it. */
function listedId(itemContent: Json): string | undefined {
  // A post with limited visibility nests in a wrapper of its own.
  const unwrap = (r: Json) => (isRecord(r.tweet) ? r.tweet : r);
  const tweet = unwrap(result(itemContent.tweet_results));
  const original = unwrap(result(record(tweet.legacy).retweeted_status_result));
  const id = asString(original.rest_id) ?? asString(tweet.rest_id);
  return id !== undefined && X_ID.test(id) ? id : undefined;
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
  // X's Pinned Lists tiles repeat Lists it also lists under Your Lists, each with its Pin.
  if (item.displayType === "ListTile") return undefined;
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
    ...(typeof list.following === "boolean" ? { following: list.following } : {}),
    ...(typeof list.pinning === "boolean" ? { pinned: list.pinning } : {}),
    // X's row: ListWithPin on Your Lists, ListWithSubscribe on Discover new Lists.
    ...(item.displayType === "ListWithPin"
      ? { button: "pin" as const }
      : item.displayType === "ListWithSubscribe"
        ? { button: "follow" as const }
        : {}),
  };
}

/**
 * The List one of X's List writes answers with (bundle.UserLists' calls), as the write leaves it:
 * X's own code counts a Follow, Unfollow, Pin or Unpin that answered with the List as taken.
 */
function readListWrite(op: string, data: Json): EngineList | undefined {
  switch (op) {
    case "CreateList":
    case "UpdateList":
    case "ListAddMember":
    case "ListRemoveMember":
    case "EditListBanner":
    case "DeleteListBanner":
      return readList({ list: data.list }, null);
    case "ListSubscribe": {
      const list = readList({ list: data.list_subscribe_v3 }, null);
      return list && { ...list, following: true };
    }
    // X takes a List the user unfollows off Home's pinned tabs too.
    case "ListUnsubscribe": {
      const list = readList({ list: data.list }, null);
      return list && { ...list, following: false, pinned: false };
    }
    case "PinTimeline":
    case "UnpinTimeline": {
      const pinned = record(
        record(op === "PinTimeline" ? data.pin_timeline : data.unpin_timeline)
          .updated_pinned_timeline,
      );
      const list =
        pinned.__typename === "ListPinnedTimeline"
          ? readList({ list: pinned.list }, null)
          : undefined;
      return list && { ...list, pinned: op === "PinTimeline" };
    }
    default:
      return undefined;
  }
}

/**
 * A Community in any of X's shapes for it: a carousel tile (name and banner), a card or its own
 * page (counts, rules, the viewer's role). A post's bare community reference names none of it.
 */
function readCommunity(value: Json): EngineCommunity | undefined {
  const communityId = asString(value.id_str) ?? asString(value.rest_id);
  const name = asString(value.name);
  if (communityId === undefined || !X_ID.test(communityId) || name === undefined) return undefined;
  const banner = (m: unknown) => asString(record(record(m).media_info).original_img_url);
  const rules = Array.isArray(value.rules)
    ? value.rules.flatMap((r) => {
        const rule = asString(record(r).name);
        return rule === undefined
          ? []
          : [{ name: rule, description: asString(record(r).description) ?? "" }];
      })
    : null;
  return {
    communityId,
    name,
    description: asString(value.description) ?? null,
    bannerUrl: banner(value.custom_banner_media) ?? banner(value.default_banner_media) ?? null,
    members: asCount(value.member_count),
    topic: asString(record(value.primary_community_topic).topic_name) ?? null,
    rules,
    joinPolicy: asString(value.join_policy) ?? null,
    role: asString(value.role) ?? null,
  };
}

/**
 * A module of people under X's own header (a Community's Moderators, its Members), with where its
 * footer's "Show more" goes. X links there on twitter.com; the engine lives on x.com.
 */
function readSection(entry: Json): EnginePeopleSection | undefined {
  const content = record(entry.content);
  const title = asString(record(content.header).text);
  if (typeof entry.entryId !== "string" || title === undefined) return undefined;
  const items = arr(content.items).map((i) => record(record(record(i).item).itemContent));
  if (items.length === 0 || items.some((i) => i.itemType !== "TimelineUser")) return undefined;
  const link = asString(record(record(content.footer).landingUrl).url);
  return {
    title,
    userIds: items.flatMap((i) => readUser(record(i.user_results).result)?.userId ?? []),
    link: link?.replace(/^https:\/\/(www\.)?twitter\.com\//, "https://x.com/") ?? null,
  };
}

const flag = (value: unknown) => (typeof value === "boolean" ? value : null);

/**
 * An NBA game in any of X's shapes for it: a card in a team's schedule, a game on the day's
 * scoreboard, or the game's own hydrate and live calls, whose re-polls carry only the score and
 * the plays since the last one.
 */
function readGame(game: Json): EngineGame | undefined {
  const gameId = asString(game.rest_id);
  if (gameId === undefined || !X_ID.test(gameId)) return undefined;
  const live = record(game.live);
  const summary = record(game.summary);
  const side = (at: "away" | "home"): EngineGameTeam => {
    const team = record(summary[at]);
    return {
      abbreviation: asString(team.abbreviation) ?? null,
      name: asString(team.name) ?? null,
      points: asCount(live[`${at}_points`]) ?? asCount(team.points),
      timeouts: asCount(live[`${at}_timeouts`]),
      bonus: flag(live[`${at}_bonus`]),
    };
  };
  // The newest play by X's sequence, a millisecond count sent as a string.
  const last = arr(record(game.plays).periods)
    .flatMap((p) => arr(record(p).plays))
    .filter(isRecord)
    .reduce<Json | undefined>(
      (newest, play) =>
        newest === undefined || Number(play.sequence) >= Number(newest.sequence) ? play : newest,
      undefined,
    );
  const description = asString(last?.description);
  const ms = asString(summary.scheduled_ms);
  return {
    gameId,
    status: asString(live.status) ?? asString(summary.status) ?? null,
    startsAt: ms !== undefined && /^\d+$/.test(ms) ? new Date(Number(ms)).toISOString() : null,
    away: side("away"),
    home: side("home"),
    period: asCount(live.quarter) ?? asCount(summary.quarter),
    periodType: asString(live.period_type) ?? asString(summary.period_type) ?? null,
    clock: asString(live.clock) ?? asString(summary.clock) ?? null,
    halftime: flag(live.halftime),
    lastPlay: description === undefined ? null : { kind: asString(last?.kind) ?? "", description },
  };
}

/** X's prompt in a timeline (the Subs tab's subscribe prompt): its words and its button. */
function readPrompt(item: Json): EnginePrompt | undefined {
  const content = record(item.content);
  const header = asString(content.headerText)?.trim();
  if (header === undefined) return undefined;
  const action = record(content.primaryButtonAction);
  const text = asString(action.text);
  const url = asString(record(action.action).url);
  return {
    header,
    body: asString(content.bodyText)?.trim() ?? "",
    // X links there on twitter.com; the engine lives on x.com.
    button:
      text === undefined || url === undefined
        ? null
        : { text, url: url.replace(/^https:\/\/(www\.)?twitter\.com\//, "https://x.com/") },
  };
}

/** X's titled box of posts on Explore (For you's "Posts For You"): its header, with no people. */
function readPostsModule(entry: Json): EngineModule | undefined {
  const content = record(entry.content);
  const title = asString(record(content.header).text);
  const items = arr(content.items).map((i) => record(record(record(i).item).itemContent));
  return typeof entry.entryId === "string" &&
    title !== undefined &&
    content.displayType === "Vertical" &&
    items.length > 0 &&
    items.every((i) => i.itemType === "TimelineTweet")
    ? { id: entry.entryId, title, userIds: [] }
    : undefined;
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

/** One tile of X's GIF search; none without an id or a picture. */
function readGif(item: unknown): ReadonlyArray<EngineGif> {
  if (!isRecord(item)) return [];
  const id = asString(item.id);
  const preview = record(item.preview_image);
  const url = asString(preview.url);
  if (id === undefined || url === undefined) return [];
  return [
    {
      id,
      altText: asString(item.alt_text) ?? null,
      url,
      stillUrl: asString(preview.still_image_url) ?? null,
      width: asNumber(preview.width),
      height: asNumber(preview.height),
      provider: asString(record(item.provider).display_name) ?? "",
    },
  ];
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

const INSPIRATION_ID = "Timeline:\x0c\x00\xca";
const FILTER_WORD = /^[A-Za-z-]{1,40}$/;

/**
 * X's Inspiration (Creator Studio's top posts) names its filters inside the timelineId it asks
 * GenericTimelineById for: base64 of "Timeline:" and a thrift struct (field 202) of strings, the
 * engagement (1), language (2) and period (6). Keyed `inspiration:Likes:Daily:en`; an Explore
 * tab's id (field 182) or any shape this does not know is null.
 */
function inspirationKey(timelineId: string | undefined): string | null {
  let raw: string;
  try {
    raw = atob(timelineId ?? "");
  } catch {
    return null;
  }
  if (!raw.startsWith(INSPIRATION_ID)) return null;
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const fields = new Map<number, string>();
  let at = INSPIRATION_ID.length;
  // Each string field is its type (11), id and length, then its bytes; a stop byte ends the struct.
  while (bytes[at] === 11 && at + 7 <= bytes.length) {
    const length = view.getUint32(at + 3);
    fields.set(view.getUint16(at + 1), raw.slice(at + 7, at + 7 + length));
    at += 7 + length;
  }
  const [engagement, language, period] = [fields.get(1), fields.get(2), fields.get(6)];
  return bytes[at] === 0 &&
    [engagement, period, language].every((v) => v !== undefined && FILTER_WORD.test(v))
    ? `inspiration:${engagement}:${period}:${language}`
    : null;
}

/** The search X's Radar page runs for a query's posts: the query, then its own range. */
const RADAR_POSTS = /^([^]+) -is:retweet since:\d{4}-\d{2}-\d{2}(?: until:\d{4}-\d{2}-\d{2})?$/;

const isoOf = (value: unknown) => {
  const date = typeof value === "number" || typeof value === "string" ? new Date(value) : null;
  return date === null || Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** X's daily counts (`InsightsPostsCount`, seconds); a day before `complete` is still counting. */
const radarCounts = (counts: unknown, complete?: number): ReadonlyArray<EngineRadarCount> =>
  arr(counts).flatMap((c) => {
    const start = record(c).start_time;
    const count = asCount(record(c).count);
    if (typeof start !== "number") return [];
    return [
      {
        at: new Date(start * 1000).toISOString(),
        count: complete !== undefined && start < complete ? null : count,
      },
    ];
  });

/**
 * A Radar query in X's shape (`ApiInsightRule`) and when it last changed, which X's list sorts
 * by. Its query is what X's page searches: its tags joined by OR, else its raw query.
 */
function radarRule(item: unknown) {
  const rule = record(item);
  const core = record(rule.core);
  const id = asString(rule.rest_id);
  const createdAt = isoOf(core.created_at);
  let tags: unknown = null;
  try {
    tags = JSON.parse(asString(core.tags) ?? "null");
  } catch {}
  const query =
    (Array.isArray(tags) && tags.every((t) => typeof t === "string") ? tags.join(" OR ") : "") ||
    (asString(core.advanced_query) ?? "");
  if (id === undefined || !X_ID.test(id) || createdAt === undefined) return [];
  const radar: EngineRadarQuery = {
    id,
    title: asString(core.title) ?? "",
    query,
    createdAt,
    preview: radarCounts(record(rule.preview).counts),
  };
  return [{ radar, updated: Date.parse(isoOf(core.updated_at) ?? createdAt) }];
}

/** X's Radar (Relay, Premium): its queries, how many it allows, and a query's daily counts. */
function readRadar(
  op: string,
  data: Json,
): Pick<EngineBatch, "radarQueries" | "radarLimit" | "radarCounts" | "radarDeleted"> {
  const deleted = record(data.delete_insight_rule_v2);
  const gone = asString(record(deleted.result).rest_id);
  if (op === "deleteInsightButtonMutation" && deleted.__typename === "InsightRuleMutationSuccess")
    return gone === undefined ? {} : { radarDeleted: gone };
  const user = result(record(data.viewer_v2).user_results);
  const rules = record(user.insight_rules).items;
  if (op === "insightsListContextQuery" && Array.isArray(rules))
    return {
      radarQueries: rules
        .flatMap(radarRule)
        .toSorted((a, b) => b.updated - a.updated)
        .map((r) => r.radar),
    };
  if (op === "insightProviderGetQuery") {
    const rule = radarRule(user.insight_rule_by_id)[0];
    return rule === undefined ? {} : { radarQueries: [rule.radar] };
  }
  const limit = record(user.insights_config).saved_query_limit;
  if (op === "insightsConfigQuery" && typeof limit === "number") return { radarLimit: limit };
  const counts = record(record(user.insight_rule_by_id).matched_post_counts);
  if (op === "usePostCountQuery" && Array.isArray(counts.counts)) {
    const complete = counts.oldest_complete_count;
    return {
      radarCounts: radarCounts(counts.counts, typeof complete === "number" ? complete : undefined),
    };
  }
  return {};
}

/**
 * A post in X's Radar list (postListQuery), in X's newer shape: text, time and entities under
 * `details`, counts under `counts`, no media.
 */
function readRadarPost(tweet: Json): EnginePost | undefined {
  const postId = asString(tweet.rest_id);
  const user = readUser(result(record(tweet.core).user_results));
  const details = record(tweet.details);
  const createdAt = isoOf(Number(details.created_at_ms));
  const counts = record(tweet.counts);
  if (postId === undefined || !X_ID.test(postId) || user === undefined || createdAt === undefined)
    return undefined;
  const text = (asString(details.full_text) ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  // The legacy entity names, so the shared readers place them.
  const source = {
    urls: tweet.url_entities,
    user_mentions: tweet.mention_entities,
    hashtags: details.hashtag_entities,
    symbols: details.cashtag_entities,
  };
  const links = readLinks(source);
  return {
    postId,
    author: {
      userId: user.userId,
      handle: user.handle,
      name: user.name,
      followers: user.followers,
      verified: user.verified,
    },
    text,
    createdAt,
    isReply: false,
    isRepost: false,
    isPromoted: false,
    hasMedia: false,
    hasLink: links.length > 0,
    metrics: {
      views: asCount(record(tweet.views).count),
      likes: asCount(counts.favorite_count) ?? 0,
      reposts: asCount(counts.retweet_count) ?? 0,
      replies: asCount(counts.reply_count) ?? 0,
      quotes: asCount(counts.quote_count) ?? 0,
      bookmarks: asCount(counts.bookmark_count) ?? 0,
    },
    avatarUrl: user.avatarUrl,
    media: [],
    quotedId: null,
    replyToId: null,
    replyingTo: [],
    entities: readEntities(source, links, text),
    card: null,
    poll: null,
    note: null,
    context: null,
    liked: false,
    reposted: false,
    bookmarked: false,
    conversation: null,
    edits: [],
    editsRemaining: null,
    editableUntil: null,
    aiGenerated: false,
    translation: null,
  };
}

/** X's two post tabs of a search of Communities: Top, and Latest. */
const HUB_SEARCH_POSTS = /^GlobalCommunities(Latest)?PostSearchTimeline$/;

/** What one operation's request asked for, when the operation serves many pages. */
function keyOf(op: string, variables: Json, exploreTabs: ReadonlyArray<EngineExploreTab> | null) {
  const s = (k: string) => asString(variables[k]);
  // One list per query; X's picker opens on its empty query.
  if (op === "GifSearch") return `gifs:${s("query") ?? ""}`;
  if (op === "HomeTimeline") return s("tag") === undefined ? null : `tag:${s("tag")}`;
  // A search inside a Community, one list per order and query; Top is X's default, by likes.
  if (op === "CommunityTweetSearchModuleQuery")
    return s("communityId") === undefined || s("query") === undefined
      ? null
      : `communitySearch:${s("communityId")}:${s("timelineRankingMode") ?? "Likes"}:${s("query")}`;
  // X's search of Communities, by its query: the operation is the tab (Communities, Top, Latest).
  if (op === "CommunitiesSearchQuery") return s("query") || null;
  if (HUB_SEARCH_POSTS.test(op)) return s("rawQuery") || null;
  // Every Community call names it; a Community's Latest is its posts by Recency, its own list.
  if (op.startsWith("Communit") && s("communityId") !== undefined) {
    const mode = s("rankingMode");
    return op === "CommunityTweetsTimeline" && mode !== undefined && mode !== "Relevance"
      ? `community:${s("communityId")}:${mode}`
      : `community:${s("communityId")}`;
  }
  if (op.startsWith("List") && s("listId") !== undefined) return `list:${s("listId")}`;
  if (op === "NotificationsTimeline") return s("timeline_type") ?? null;
  const inspiration = op === "GenericTimelineById" ? inspirationKey(s("timelineId")) : null;
  if (inspiration !== null) return inspiration;
  if (op === "GenericTimelineById") return s("timelineId") ?? null;
  // Explore's first page is its "for_you" tab, fetched by another name.
  if (op === "ExplorePage") return exploreTabs?.find((t) => t.id === "for_you")?.timelineId ?? null;
  if (op === "SearchTimeline")
    return s("product") === undefined || s("rawQuery") === undefined
      ? null
      : `${s("product")}:${s("rawQuery")}`;
  if (op === "TweetDetail") {
    // Each reply order is its own list (`?sort_replies=` on X's page); Relevance is X's default.
    const mode = s("rankingMode");
    const id = s("focalTweetId");
    return id === undefined
      ? null
      : mode === undefined || mode === "Relevance"
        ? id
        : `${id}:${mode}`;
  }
  if (op === "UserByScreenName") return s("screen_name")?.toLowerCase() ?? null;
  // A post's reposters and likers (X's Post activity).
  if (op === "Retweeters" || op === "Favoriters") return s("tweetId") ?? null;
  if (op === "TweetActivityQuery") return s("restId") ?? null;
  const accountAnalytics = accountAnalyticsKey(op, variables);
  if (accountAnalytics !== undefined) return accountAnalytics;
  // A news story's page asks for it by its trend id.
  if (op === "AiTrendByRestId") return s("trendId") ?? null;
  // X's Follow page asks with a JSON context: empty for Who to follow, only the creators flag
  // for its other tab. Any other context (people like someone) is no tab of that page.
  if (op === "ConnectTabTimeline") {
    let context: unknown;
    try {
      context = JSON.parse(s("context") ?? "");
    } catch {
      return null;
    }
    if (!isRecord(context) || Array.isArray(context)) return null;
    const keys = Object.keys(context);
    return keys.length === 0
      ? "connect:who"
      : keys.length === 1 && context.isCreatorOnlyConnectTab === true
        ? "connect:creators"
        : null;
  }
  // A team's schedule and a game's own calls name it by id; a game's posts by its gameId.
  if (op === "UserSportsProfile" || op === "NBAGameHydrate" || op === "NBALiveGame")
    return s("rest_id") ?? null;
  if (op === "SportsGameTopTimeline" || op === "SportsGameLatestTimeline")
    return s("gameId") ?? null;
  // A bookmark folder's posts, by the folder.
  if (op === "BookmarkFolderTimeline") return s("bookmark_collection_id") ?? null;
  // X's Radar: its one list, a query's own page and counts by its id, and a query's posts per tab.
  if (op === "insightsListContextQuery") return "radar";
  if (op === "insightProviderGetQuery" || op === "usePostCountQuery") return s("id") ?? null;
  if (op === "postListQuery") {
    const query = RADAR_POSTS.exec(s("query") ?? "")?.[1];
    return query === undefined || s("product") === undefined
      ? null
      : `radar:${s("product")}:${query}`;
  }
  return s("userId") ?? null;
}

/** A profile's people pages (X's Followers, Following, Followers you know, Verified Followers). */
const PEOPLE_PAGES = /^(Followers|Following|FollowersYouKnow|BlueVerifiedFollowers)$/;

/**
 * Everything in one response for the engine's screens. People are the ones X lists (search
 * People, Who to follow, a profile's own header), not every post's author.
 */
export function renderEngineBatch(op: string, variables: Json, body: unknown): EngineBatch {
  const people: Array<string> = [];
  const sections: Array<EnginePeopleSection> = [];
  const order: Array<string> = [];
  const modules: Array<EngineModule> = [];
  const conversations = new Map<string, NonNullable<EnginePost["conversation"]>>();
  const trends: Array<EngineTrend> = [];
  const notifications: Array<EngineNotification> = [];
  const lists: Array<EngineList> = [];
  const communities = new Map<string, EngineCommunity>();
  const games = new Map<string, EngineGame>();
  let prompt: EnginePrompt | undefined;
  let top: string | null = null;
  let bottom: string | null = null;
  const explore = op === "ExplorePage" || op === "GenericTimelineById";
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
    if (type === "TimelineTweet") {
      const id = listedId(node);
      if (id !== undefined && !order.includes(id)) order.push(id);
    }
    const amongPosts =
      typeof node.entryId === "string" &&
      node.entryId.startsWith("who-to-follow") &&
      Array.isArray(record(node.content).items) &&
      asString(record(record(node.content).header).text) !== undefined;
    // A Who to follow among the posts is a module, not one of a page's titled boxes of people.
    const section = amongPosts ? undefined : readSection(node);
    if (section !== undefined) sections.push(section);
    // Listed before its posts, which the walk reaches next, so the header draws where X put it.
    const titled = explore ? readPostsModule(node) : undefined;
    if (titled !== undefined && !order.includes(titled.id)) {
      order.push(titled.id);
      modules.push(titled);
    }
    if (type === "TimelineUser") {
      const user = readUser(record(node.user_results).result);
      if (user !== undefined && !people.includes(user.userId)) people.push(user.userId);
    } else if (amongPosts && typeof node.entryId === "string") {
      // X's Who to follow among the posts, under its header: listed where it sits, its people in
      // X's order. A box with no header is a people page's own list.
      const content = record(node.content);
      const userIds = arr(content.items).flatMap(
        (item) =>
          readUser(result(record(record(record(item).item).itemContent).user_results))?.userId ??
          [],
      );
      if (userIds.length > 0 && !order.includes(node.entryId)) {
        order.push(node.entryId);
        modules.push({
          id: node.entryId,
          title: asString(record(content.header).text)!,
          userIds,
        });
      }
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
    } else if (node.__typename === "Community") {
      const community = readCommunity(node);
      if (community !== undefined && !communities.has(community.communityId))
        communities.set(community.communityId, community);
    } else if (
      isRecord(record(node.summary).away) &&
      isRecord(record(node.summary).home) &&
      typeof node.rest_id === "string" &&
      !games.has(node.rest_id)
    ) {
      // A game: X's summary names its two sides, whichever call sent it.
      const game = readGame(node);
      if (game !== undefined) games.set(game.gameId, game);
    } else if (type === "TimelineMessagePrompt") {
      prompt ??= readPrompt(node);
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
  const written = readListWrite(op, data);
  if (written !== undefined) lists.push(written);
  // X's DeleteList answers with no List; an answer with errors deleted nothing.
  const deleted = asString(variables.listId);
  const listDeleted =
    op === "DeleteList" &&
    deleted !== undefined &&
    X_ID.test(deleted) &&
    isRecord(record(body).data) &&
    !Array.isArray(record(body).errors)
      ? deleted
      : undefined;
  const exploreTabs = readExploreTabs(record(body));
  // X's GIF search is no timeline: its tiles and its next page's cursor sit in one slice.
  const gifSlice = op === "GifSearch" ? record(data.gif_search_slice) : null;
  if (gifSlice !== null) bottom = asString(record(gifSlice.slice_info).next_cursor) ?? null;
  const folders = readFolderChange(op, variables, data);
  const claims = readClaims(op, data);
  const articles = walkTweets(body, readArticle);
  return {
    op,
    // The user's Communities, once X answered with the list (empty, when they left the last one):
    // the hub's carousel, and the composer's audience card (CommunitiesMembershipsSlice, whose
    // slice sits under X's older viewer).
    key:
      op === "CarouselQuery" || op === "CommunitiesMembershipsSlice"
        ? [data.viewer_v2, data.viewer].some((v) =>
            Array.isArray(
              record(result(record(v).user_results).community_memberships_slice).items_results,
            ),
          )
          ? "communities:mine"
          : null
        : // An error alone (X's rate limit) carries no list, so it is no answer of nobody, nor
          // of an empty folder.
          (PEOPLE_PAGES.test(op) &&
              !Array.isArray(record(record(result(data.user).timeline).timeline).instructions)) ||
            (op === "BookmarkFolderTimeline" &&
              !Array.isArray(
                record(record(data.bookmark_collection_timeline).timeline).instructions,
              ))
          ? null
          : // Bookmarks X answered, posts or none: with no folder list beside it, no Premium.
            op === "Bookmarks"
            ? Array.isArray(record(record(data.bookmark_timeline_v2).timeline).instructions)
              ? "bookmarks"
              : null
            : keyOf(op, variables, exploreTabs),
    // Explore asks with an empty cursor for its first page.
    cursor: asString(variables.cursor) || null,
    top,
    bottom,
    // X's own composer answers with the post it created, outside any timeline.
    posts:
      op === "postListQuery"
        ? walkTweets(body, readRadarPost)
        : renderPostsFromGraphql(
            /^Create(Note)?Tweet$/.test(op) ? (readCreatedTweet(body) ?? body) : body,
          ).map((p) => {
            const conversation = conversations.get(p.postId);
            return conversation === undefined ? p : { ...p, conversation };
          }),
    users: readUsers(body),
    people,
    sections,
    order,
    modules,
    trends,
    notifications,
    lists,
    communities: [...communities.values()],
    ...(articles.length === 0 ? {} : { articles }),
    homeTabs: readHomeTabs(record(body)),
    exploreTabs,
    viewer: op === "Viewer" ? readViewer(result(record(data.viewer).user_results)) : null,
    ...(games.size > 0
      ? { games: [...games.values()] }
      : // X's schedule answered with no games that day: the day is empty, not unknown.
        op === "NBASchedule" && Array.isArray(record(data.nba_schedule).games)
        ? { games: [] }
        : {}),
    ...(gifSlice === null ? {} : { gifs: arr(gifSlice.items).flatMap(readGif) }),
    ...(prompt === undefined ? {} : { prompt }),
    ...readAnalytics(op, data),
    ...readAccountAnalytics(op, variables, data),
    ...readStoryAndLeague(op, data),
    ...(folders === undefined ? {} : { bookmarkFolders: folders }),
    ...(claims === undefined ? {} : { claims }),
    ...readRadar(op, data),
    ...(listDeleted === undefined ? {} : { listDeleted }),
  };
}

const DAY_MS = 86_400_000;
/** Milliseconds from a number, or from an ISO time or X's `{ iso8601_time }`; NaN for neither. */
const msOf = (value: unknown) =>
  typeof value === "number"
    ? value
    : Date.parse(asString(value) ?? asString(record(value).iso8601_time) ?? "");

/** The days a range of X's analytics spans; X's ranges end a millisecond short of midnight. */
const spanDays = (from: unknown, to: unknown) => Math.round((msOf(to) - msOf(from)) / DAY_MS);

/**
 * X's account analytics queries (x.com/i/account_analytics) and the range each asked for, in
 * days. The video overview asks for its range and the one before it at once.
 */
const ACCOUNT_ANALYTICS: Readonly<
  Record<string, (v: Json) => { kind: EngineAccountAnalytics["kind"]; days: number | null }>
> = {
  accountOverviewDailyQuery: (v) => ({
    kind: "overview",
    days: spanDays(v.current_from, v.current_to),
  }),
  contentPageQuery: (v) => ({ kind: "content", days: spanDays(v.from_time, v.to_time) }),
  mediaMetricsQuery: (v) => ({
    kind: "video",
    days: Math.round(spanDays(v.from_timestamp, v.to_timestamp) / 2),
  }),
  videoListProviderQuery: () => ({ kind: "videos", days: null }),
  audienceOverviewDataQuery: (v) => ({
    kind: "audience",
    days: spanDays(v.from_time_incl, v.to_time_excl),
  }),
};

/** `<kind>:<days>` for an account analytics answer; undefined for any other operation. */
function accountAnalyticsKey(op: string, variables: Json): string | null | undefined {
  if (!Object.hasOwn(ACCOUNT_ANALYTICS, op)) return undefined;
  const { kind, days } = ACCOUNT_ANALYTICS[op]!(variables);
  // X's next pages of videos, as its own list scrolls: Xtend lists the first.
  if (days === null)
    return variables.cursor === null || variables.cursor === undefined ? kind : null;
  return Number.isSafeInteger(days) && days > 0 ? `${kind}:${days}` : null;
}

/** X's overview counts its engagement types as these metrics (its `cd` map). */
const ENGAGEMENT_METRIC: Readonly<Record<string, string>> = {
  Bookmark: "Bookmark",
  Displayed: "Impressions",
  Fav: "Likes",
  Follow: "Follows",
  ProfilePic: "ProfileVisits",
  QuoteCreate: "CreateQuote",
  QuoteTweet: "Retweets",
  Reply: "Replies",
  ReplyCreate: "CreateReply",
  Retweet: "Retweets",
  Share: "Share",
  TweetCreate: "CreateTweet",
  Unfollow: "Unfollows",
};

/** Sums X's `{ engagement_type, count }` rows by metric. */
function countRows(rows: ReadonlyArray<unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const metric = ENGAGEMENT_METRIC[asString(record(row).engagement_type) ?? ""];
    if (metric !== undefined) out[metric] = (out[metric] ?? 0) + Number(record(row).count ?? 0);
  }
  return out;
}

/** X's rows by the day (its UTC midnight) each counts. */
function rowsByDay(rows: unknown): ReadonlyMap<number, ReadonlyArray<unknown>> {
  const out = new Map<number, Array<unknown>>();
  for (const row of arr(rows)) {
    const day = msOf(record(row).timestamp);
    out.set(day, [...(out.get(day) ?? []), row]);
  }
  return out;
}

/** X's `[{ metric_type, metric_value }]` as counts; a value X leaves out is 0. */
const metricValues = (values: unknown): Record<string, number> =>
  Object.fromEntries(
    arr(values).flatMap((m) => {
      const type = asString(record(m).metric_type);
      return type === undefined ? [] : [[type, asNumber(record(m).metric_value)]];
    }),
  );

/** X's follows and unfollows per day, which replace the engagement rows' own (X's `cj`). */
const followsByDay = (series: unknown) =>
  new Map(
    arr(series).map((point) => [
      msOf(record(point).timestamp),
      metricValues(record(point).metric_values),
    ]),
  );
const followsOf = (counts: Readonly<Record<string, number>>) => ({
  Follows: counts.Follows ?? 0,
  Unfollows: counts.Unfollows ?? 0,
});

const MEDIA_KEY = /^(7|13)_(\d{1,20})$/;

/**
 * X's account analytics answers, read as X's page reads them.
 * Each kind keeps X's own numbers; what X's page derives (engagement rate, totals) is the screen's.
 */
function readAccountAnalytics(
  op: string,
  variables: Json,
  data: Json,
): Pick<EngineBatch, "accountAnalytics"> {
  const key = accountAnalyticsKey(op, variables);
  if (key === undefined || key === null) return {};
  const days = Number(key.split(":")[1]);
  const viewer = result(record(data.viewer_v2).user_results);
  // An error alone (X's rate limit, no access) carries no user.
  if (viewer.__typename !== "User") return {};
  switch (op) {
    case "accountOverviewDailyQuery": {
      const from = msOf(variables.current_from);
      const byDay = rowsByDay(viewer.current_time_series);
      const backfill = rowsByDay(viewer.hourly_backfill);
      const daily = Array.from({ length: days }, (_, i) =>
        countRows(byDay.get(from + i * DAY_MS) ?? []),
      );
      // The latest days X has not counted yet read from its hourly counts, as X's page does.
      for (let i = days - 1; i >= 0 && (daily[i]!.Impressions ?? 0) === 0; i--) {
        const hours = backfill.get(from + i * DAY_MS);
        if (hours !== undefined) daily[i] = countRows(hours);
      }
      const follows = followsByDay(viewer.legacy_current_follow_metrics);
      const previousFollows = [...followsByDay(viewer.legacy_previous_follow_metrics).values()];
      return {
        accountAnalytics: {
          kind: "overview",
          days,
          from: new Date(from).toISOString(),
          daily: daily.map((counts, i) => {
            const day = follows.get(from + i * DAY_MS);
            return day === undefined ? counts : { ...counts, ...followsOf(day) };
          }),
          previous: {
            ...countRows(arr(viewer.previous_totals)),
            Follows: previousFollows.reduce((n, d) => n + (d.Follows ?? 0), 0),
            Unfollows: previousFollows.reduce((n, d) => n + (d.Unfollows ?? 0), 0),
          },
          followers: asNumber(record(viewer.relationship_counts).followers),
          verifiedFollowers:
            typeof viewer.verified_follower_count === "number"
              ? viewer.verified_follower_count
              : null,
        },
      };
    }
    case "contentPageQuery":
      return {
        accountAnalytics: {
          kind: "content",
          days,
          posts: arr(viewer.tweets_results).flatMap((entry) => {
            const tweet = result(entry);
            const postId = asString(tweet.rest_id);
            const details = record(tweet.details);
            if (postId === undefined || !X_ID.test(postId)) return [];
            const range = arr(details.display_text_range);
            const text = [...(asString(details.full_text) ?? "")];
            return [
              {
                postId,
                text: text.slice(asNumber(range[0]), asNumber(range[1]) || undefined).join(""),
                createdAt: new Date(asNumber(details.created_at_ms)).toISOString(),
                reply: asString(record(tweet.reply_to_results).rest_id) !== undefined,
                community: asString(record(tweet.community_results).rest_id) !== undefined,
                metrics: metricValues(tweet.organic_metrics_total),
              },
            ];
          }),
        },
      };
    case "mediaMetricsQuery": {
      // X counts the range only, from its first day; the rows before are the range before it.
      const start = msOf(variables.to_timestamp) + 1 - days * DAY_MS;
      const totals: Record<string, number> = {};
      for (const point of arr(record(viewer.media_metrics_time_series_for_publisher).metric_values))
        if (msOf(record(point).timestamp) >= start)
          for (const [metric, value] of Object.entries(metricValues(record(point).metric_values)))
            totals[metric] = (totals[metric] ?? 0) + value;
      return { accountAnalytics: { kind: "video", days, totals } };
    }
    case "videoListProviderQuery": {
      const seen = new Set<string>();
      const videos = arr(record(viewer.get_media_filtered).media_results).flatMap((entry) => {
        const media = result(entry);
        const mediaKey = asString(media.media_key) ?? "";
        const id = MEDIA_KEY.exec(mediaKey)?.[2];
        if (id === undefined || seen.has(mediaKey)) return [];
        seen.add(mediaKey);
        const info = record(media.media_info);
        const views = record(media.video_view_count).total;
        // shortcut: the first post X lists carries the video; X picks its earliest, which needs
        // the post's date X's Relay resolver reads. Upgrade if a video lists several posts.
        const postId = arr(media.get_media_posts_results)
          .map((p) => asString(record(p).rest_id))
          .find((p) => p !== undefined && X_ID.test(p));
        return [
          {
            mediaKey,
            name: asString(media.video_media_name) ?? "",
            views: typeof views === "number" ? views : asNumber(media.public_video_view_count),
            durationMs: asNumber(info.duration_millis),
            previewUrl: asString(record(info.preview_image).original_img_url) ?? null,
            postId: postId ?? null,
            // A media id is a snowflake: its time is in its upper bits, as X's page reads it.
            createdAt: new Date(Number((BigInt(id) >> 22n) + 1_288_834_974_657n)).toISOString(),
          },
        ];
      });
      return {
        accountAnalytics: {
          kind: "videos",
          videos: videos.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
        },
      };
    }
    case "audienceOverviewDataQuery": {
      const text = (value: unknown) => asString(value) ?? null;
      const row = (r: Json) => ({
        type: asString(r.engagement_type) ?? "",
        count: Number(r.count ?? 0),
        age: text(r.age),
        gender: text(r.gender),
        app:
          r.client_app_id === undefined || r.client_app_id === null
            ? null
            : String(r.client_app_id),
        country: text(r.country),
      });
      return {
        accountAnalytics: {
          kind: "audience",
          days,
          rows: [
            ...arr(viewer.uec_metrics_daily_time_series_count),
            ...arr(viewer.uec_country_metrics_daily_time_series_count),
          ]
            .map((r) => row(record(r)))
            .filter((r) => r.type !== ""),
        },
      };
    }
    default:
      return {};
  }
}

const recordOf = (value: unknown): EngineRecord | null => {
  const r = record(value);
  return typeof r.wins === "number" && typeof r.losses === "number"
    ? { wins: r.wins, losses: r.losses }
    : null;
};
const numberOr = (value: unknown) => (typeof value === "number" ? value : null);
/** X's name for a conference or division, its alias when the name is empty. */
const groupName = (value: unknown) =>
  asString(record(value).name) || asString(record(value).alias) || "";

/**
 * X's news story (AiTrendByRestId) and its NBA league page's standings and stat leaders
 * (NBAStandings, NBALeaders), as X's pages read them: standings in each division by X's rank,
 * then by games over .500 and wins; leaders by rank.
 */
function readStoryAndLeague(
  op: string,
  data: Json,
): Pick<EngineBatch, "story" | "standings" | "leaders"> {
  if (op === "AiTrendByRestId") {
    const page = record(result(data.ai_trend_by_rest_id).page);
    const article = record(page.article);
    const title = asString(article.title);
    if (title === undefined) return {};
    const updated = Number(page.last_updated_at_ms);
    return {
      story: {
        title,
        summary: asString(record(article.article_text).text) ?? "",
        updatedAt: updated > 0 ? new Date(updated).toISOString() : null,
        disclaimer: asString(page.disclaimer) ?? null,
        timelines: arr(page.post_timelines).flatMap((t) => {
          const timelineId = asString(record(record(t).post_timeline).id);
          return timelineId === undefined
            ? []
            : [{ label: asString(record(t).label) ?? "", timelineId }];
        }),
      },
    };
  }
  if (op === "NBAStandings") {
    const conferences = record(data.nba_standings).conferences;
    if (!Array.isArray(conferences)) return {};
    const rank = (t: Json) => numberOr(t.division_rank) ?? Number.MAX_SAFE_INTEGER;
    return {
      standings: conferences.map((c) => ({
        name: groupName(record(c).conference),
        divisions: arr(record(c).divisions).map((d) => ({
          name: groupName(record(d).division),
          teams: arr(record(d).teams)
            .map(record)
            .toSorted(
              (a, b) =>
                rank(a) - rank(b) ||
                asNumber(b.wins) - asNumber(b.losses) - (asNumber(a.wins) - asNumber(a.losses)) ||
                asNumber(b.wins) - asNumber(a.wins),
            )
            .map((t) => ({
              teamId: asString(record(t.team).rest_id) ?? "",
              abbreviation: asString(t.abbreviation) ?? "",
              name: asString(t.name) ?? "",
              wins: asNumber(t.wins),
              losses: asNumber(t.losses),
              gamesBack: numberOr(t.games_behind_division),
              home: recordOf(t.home),
              road: recordOf(t.road),
              division: recordOf(t.vs_division),
              conference: recordOf(t.vs_conference),
              pointsFor: numberOr(t.points_for),
              pointsAgainst: numberOr(t.points_against),
              pointDiff: numberOr(t.point_diff),
              streak: asString(t.streak) || null,
              lastTen: recordOf(t.last_10),
            })),
        })),
      })),
    };
  }
  if (op === "NBALeaders") {
    const categories = record(data.nba_leaders).categories;
    if (!Array.isArray(categories)) return {};
    return {
      leaders: categories.flatMap((c) => {
        const leaders = arr(record(c).leaders)
          .map(record)
          .toSorted((a, b) => asNumber(a.rank) - asNumber(b.rank))
          .map((l) => {
            const info = record(record(l.player).info);
            return {
              rank: asNumber(l.rank),
              name: asString(info.full_name) ?? asString(l.name) ?? "",
              position: asString(info.position) ?? asString(l.position) ?? null,
              value: asString(l.display_value) ?? String(asNumber(l.value)),
              headshotUrl: asString(record(info.headshot).url) ?? null,
            };
          });
        return leaders.length === 0
          ? []
          : [
              {
                key: asString(record(c).key) ?? "",
                title: asString(record(c).name) ?? "",
                leaders,
              },
            ];
      }),
    };
  }
  return {};
}

/** X's Post Analytics numbers (TweetActivityQuery), by X's metric name. */
function readAnalytics(op: string, data: Json): Pick<EngineBatch, "analytics"> {
  const grid = result(data.tweet_result_by_rest_id).datapoints_grid;
  if (op !== "TweetActivityQuery" || !Array.isArray(grid)) return {};
  return {
    analytics: Object.fromEntries(
      grid.flatMap((d) => {
        const metric = asString(record(d).metric_type);
        return metric === undefined ? [] : [[metric, asNumber(record(d).metric_value)]];
      }),
    ),
  };
}

/** A bookmark folder in X's BookmarkCollection shape; none without an id or a name. */
function readFolder(value: Json): ReadonlyArray<EngineBookmarkFolder> {
  const folderId = asString(value.id);
  const name = asString(value.name);
  if (folderId === undefined || !X_ID.test(folderId) || name === undefined) return [];
  const imageUrl = asString(record(record(value.media).media_info).original_img_url) ?? null;
  return [{ folderId, name, imageUrl }];
}

/**
 * What X's folder calls say of the user's bookmark folders (bundle.BookmarkFolders' operations):
 * the list, or what X's own dialog or row just did, which X's writes answer with "Done".
 */
function readFolderChange(op: string, variables: Json, data: Json): EngineFolderChange | undefined {
  const id = (k: string) => {
    const value = asString(variables[k]);
    return value !== undefined && X_ID.test(value) ? value : undefined;
  };
  const folderId = id("bookmark_collection_id");
  const postId = id("tweet_id");
  switch (op) {
    case "BookmarkFoldersSlice": {
      const slice = record(result(record(data.viewer).user_results).bookmark_collections_slice);
      return Array.isArray(slice.items)
        ? { kind: "list", folders: slice.items.flatMap((i) => readFolder(record(i))) }
        : undefined;
    }
    case "createBookmarkFolder":
    case "EditBookmarkFolder": {
      const update = data.bookmark_collection_update;
      // X files a new folder as its answer has it, and a renamed one under the name it asked for.
      const [folder] =
        op === "createBookmarkFolder"
          ? readFolder(record(data.bookmark_collection_create))
          : isRecord(update)
            ? readFolder({ ...update, name: variables.name })
            : [];
      return folder === undefined ? undefined : { kind: "saved", folder };
    }
    case "DeleteBookmarkFolder":
      return data.bookmark_collection_delete === "Done" && folderId !== undefined
        ? { kind: "deleted", folderId }
        : undefined;
    case "bookmarkTweetToFolder":
    case "RemoveTweetFromBookmarkFolder": {
      const added = op === "bookmarkTweetToFolder";
      const answer = added
        ? data.bookmark_collection_tweet_put
        : data.bookmark_collection_tweet_delete;
      return answer === "Done" && folderId !== undefined && postId !== undefined
        ? { kind: "post", folderId, postId, added }
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The features X's GetUserClaims says the account holds: each claim's resources are
 * `client_feature_switch/<feature>/<value>`, and X counts a feature held when its value is "true".
 */
function readClaims(op: string, data: Json): ReadonlyArray<string> | undefined {
  const claims = record(data.viewer_v2).claims;
  if (op !== "GetUserClaims" || !Array.isArray(claims)) return undefined;
  return claims.flatMap((c) =>
    arr(record(c).resources).flatMap((r) => {
      const [kind, feature, value] = (asString(record(r).rest_id) ?? "").split("/");
      return kind === "client_feature_switch" && feature !== undefined && value === "true"
        ? [feature]
        : [];
    }),
  );
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

function readViewer(value: unknown): EngineViewer | null {
  const user = readUser(value);
  return user === undefined
    ? null
    : { userId: user.userId, handle: user.handle, name: user.name, avatarUrl: user.avatarUrl };
}

/** X's REST call, on each profile load, for the people the viewer follows who follow that profile. */
export const isKnownFollowersUrl = (url: string) =>
  url.includes("/i/api/1.1/friends/following/list.json");

/**
 * How many people the viewer follows follow the profile X asked about (`user_id`), from X's
 * friends/following/list.json; null for any other answer (an error alone, no such user).
 */
export function renderKnownFollowers(url: string, body: unknown): EngineBatch | null {
  const userId = URL.canParse(url) ? new URL(url).searchParams.get("user_id") : null;
  const count = record(body).total_count;
  if (userId === null || !X_ID.test(userId) || !Number.isSafeInteger(count) || Number(count) < 0)
    return null;
  return {
    ...renderEngineBatch("FriendsFollowingList", {}, {}),
    key: userId,
    knownFollowers: Number(count),
  };
}

/** A batch that only names the signed-in account, as X's nav shows it. */
export const viewerBatch = (viewer: EngineViewer): EngineBatch => ({
  op: "ViewerFromNav",
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
  users: [],
  people: [],
  sections: [],
  order: [],
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
  homeTabs: null,
  exploreTabs: null,
  viewer,
});

/** Whether a batch carries anything a screen draws; X's many housekeeping calls carry nothing. */
export const hasEngineContent = (b: EngineBatch) =>
  b.posts.length > 0 ||
  b.users.length > 0 ||
  b.trends.length > 0 ||
  b.notifications.length > 0 ||
  b.lists.length > 0 ||
  b.communities.length > 0 ||
  b.key === "communities:mine" ||
  // A search of Communities X found nothing for still reaches its screen, which says so.
  // shortcut: an error answer reads the same; tell them apart by the body if X errs there.
  (b.key !== null && (b.op === "CommunitiesSearchQuery" || HUB_SEARCH_POSTS.test(b.op))) ||
  // A profile's people page X answered with nobody (no verified followers): the screen says so.
  (b.key !== null && PEOPLE_PAGES.test(b.op)) ||
  b.homeTabs !== null ||
  b.exploreTabs !== null ||
  b.viewer !== null ||
  (b.games?.length ?? 0) > 0 ||
  (b.op === "NBASchedule" && b.games !== undefined) ||
  b.gifs !== undefined ||
  b.prompt !== undefined ||
  b.analytics !== undefined ||
  b.knownFollowers !== undefined ||
  b.accountAnalytics !== undefined ||
  b.story !== undefined ||
  b.standings !== undefined ||
  b.leaders !== undefined ||
  b.bookmarkFolders !== undefined ||
  b.claims !== undefined ||
  // A folder, or Bookmarks, X answered with no posts: the screen says it is empty.
  (b.key !== null && (b.op === "BookmarkFolderTimeline" || b.op === "Bookmarks")) ||
  // X's Radar: an empty list or a query X found no posts for still reaches its screen.
  b.radarQueries !== undefined ||
  b.radarLimit !== undefined ||
  b.radarCounts !== undefined ||
  b.radarDeleted !== undefined ||
  b.listDeleted !== undefined ||
  (b.op === "postListQuery" && b.key !== null);

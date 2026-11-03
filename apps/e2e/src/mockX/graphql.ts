import type {
  EngineAccountAnalytics,
  EngineArticle,
  EngineBatch,
  EngineBookmarkFolder,
  EngineCommunity,
  EngineEntities,
  EngineGame,
  EngineGameTeam,
  EngineList,
  EngineMetrics,
  EngineNotification,
  EnginePost,
  EnginePrompt,
  EngineRadarQuery,
  EngineTrend,
  EngineUser,
  EngineViewer,
} from "@xtend/contracts";

/**
 * Mock X's GraphQL bodies: an engine batch written back in the shapes X sends (timeline
 * instructions, entries, `tweet_results`, `user_results`, cursors), so the desktop's capture reads
 * them as it reads x.com. `graphql.test.ts` holds the round trip: what this writes,
 * `renderEngineBatch` reads back as the batch it came from.
 */

type Json = Record<string, unknown>;

const DAYS = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const pad = (n: number) => String(n).padStart(2, "0");
/** ISO as X writes dates: "Sun Nov 01 12:00:00 +0000 2026". */
const xDate = (iso: string) => {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
};

const when = <A>(condition: boolean, value: () => A): A | Record<never, never> =>
  condition ? value() : {};

/**
 * A person in X's 2026 user shape. `typed` adds the `__typename` that makes the capture list them
 * among the response's people; X's Viewer, a List's owner and a notification's faces go without
 * here, since the screens read only their name and face.
 */
function encodeUser(u: EngineUser, typed = true): Json {
  return {
    ...when(typed, () => ({ __typename: "User" })),
    rest_id: u.userId,
    is_blue_verified: u.verified,
    profile_image_shape: u.avatarShape,
    core: {
      screen_name: u.handle,
      name: u.name,
      ...when(u.joinedAt !== null, () => ({ created_at: xDate(u.joinedAt!) })),
    },
    avatar: u.avatarUrl === null ? {} : { image_url: u.avatarUrl },
    ...when(u.bannerUrl !== null, () => ({ banner: { image_url: u.bannerUrl } })),
    profile_bio: {
      description: u.bio,
      ...when(u.website !== null, () => ({
        entities: {
          url: {
            urls: [
              {
                url: "https://t.co/site",
                expanded_url: u.website!.url,
                display_url: u.website!.display,
              },
            ],
          },
        },
      })),
    },
    ...when(u.location !== null, () => ({ location: { location: u.location } })),
    relationship_counts: {
      ...when(u.followers !== null, () => ({ followers: u.followers })),
      ...when(u.following !== null, () => ({ following: u.following })),
    },
    tweet_counts: when(u.posts !== null, () => ({ tweets: u.posts })),
    // X leaves `protected` out for public accounts in many responses; the capture reads absent as public.
    ...when(u.isProtected, () => ({ privacy: { protected: true } })),
    relationship_perspectives: { following: u.youFollow, followed_by: u.followsYou },
    verification: {
      verified: u.verified,
      ...when(u.verifiedType !== null, () => ({ verified_type: u.verifiedType })),
    },
    ...when(u.pinnedPostId !== null, () => ({
      pinned_items: { tweet_ids_str: [u.pinnedPostId] },
    })),
    ...when(u.affiliate !== null, () => ({
      affiliates_highlighted_label: {
        label: {
          description: u.affiliate!.name,
          ...when(u.affiliate!.badgeUrl !== null, () => ({
            badge: { url: u.affiliate!.badgeUrl },
          })),
          ...when(u.affiliate!.url !== null, () => ({ url: { url: u.affiliate!.url } })),
        },
      },
    })),
    ...when(u.offersSubscriptions !== undefined, () => ({
      super_follow_eligible: u.offersSubscriptions,
    })),
  };
}

type Mini = Pick<EngineUser, "userId" | "handle" | "name" | "avatarUrl">;
const encodeMini = (u: Mini): Json => ({
  rest_id: u.userId,
  core: { screen_name: u.handle, name: u.name },
  avatar: u.avatarUrl === null ? {} : { image_url: u.avatarUrl },
});

/** The author as a full person: the batch's own record of them, or one made from the post. */
const authorOf = (p: EnginePost, users: ReadonlyMap<string, EngineUser>): EngineUser =>
  users.get(p.author.userId) ?? {
    userId: p.author.userId,
    handle: p.author.handle,
    name: p.author.name,
    avatarUrl: p.avatarUrl,
    bannerUrl: null,
    bio: "",
    location: null,
    website: null,
    joinedAt: null,
    followers: p.author.followers,
    following: null,
    posts: null,
    verified: p.author.verified,
    isProtected: p.author.isProtected === true,
    youFollow: false,
    followsYou: false,
    pinnedPostId: null,
    verifiedType: null,
    avatarShape: "Circle",
    affiliate: null,
  };

const codePoints = (s: string) => [...s].length;
/** X escapes post text as HTML would. */
const escapeText = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Entities in X's raw shape, their indices moved by `shift` code points. */
function encodeEntities(e: EngineEntities, shift: number): Json {
  const at = (r: readonly [number, number] | null) =>
    r === null ? [] : [r[0] + shift, r[1] + shift];
  return {
    urls: e.urls.map((u) => ({
      url: u.url,
      expanded_url: u.expanded,
      display_url: u.display,
      indices: at(u.indices),
    })),
    user_mentions: e.mentions.map((m) => ({ screen_name: m.handle, indices: at(m.indices) })),
    hashtags: e.hashtags.map((h) => ({ text: h.tag, indices: at(h.indices) })),
    symbols: e.cashtags.map((c) => ({ text: c.tag, indices: at(c.indices) })),
  };
}

const binding = (key: string, value: Json) => ({ key, value });
const str = (key: string, value: string) => binding(key, { string_value: value, type: "STRING" });

function encodeCard(p: EnginePost): Json {
  if (p.poll !== null) {
    const poll = p.poll;
    return {
      card: {
        rest_id: `card://${p.postId}`,
        legacy: {
          name: `poll${poll.choices.length}choice_text_only`,
          binding_values: [
            ...poll.choices.flatMap((c, i) => [
              str(`choice${i + 1}_label`, c.label),
              str(`choice${i + 1}_count`, String(c.votes)),
            ]),
            ...(poll.endsAt === null
              ? []
              : [str("end_datetime_utc", poll.endsAt.replace(/\.\d{3}Z$/, "Z"))]),
            binding("counts_are_final", { boolean_value: poll.final, type: "BOOLEAN" }),
            ...(poll.voted === null ? [] : [str("selected_choice", String(poll.voted))]),
          ],
        },
      },
    };
  }
  const card = p.card;
  if (card === null) return {};
  if (card.kind === "article")
    return {
      article: {
        article_results: {
          result: {
            rest_id: /\/i\/article\/(\d+)/.exec(card.url)?.[1] ?? "0",
            title: card.title,
            ...when(card.description !== null, () => ({ preview_text: card.description })),
            ...when(card.imageUrl !== null, () => ({
              cover_media: { media_info: { original_img_url: card.imageUrl } },
            })),
          },
        },
      },
    };
  const short = p.entities.urls.find((u) => u.expanded === card.url)?.url ?? card.url;
  return {
    card: {
      rest_id: `card://${p.postId}`,
      legacy: {
        name: "summary_large_image",
        binding_values: [
          str("title", card.title),
          str("card_url", short),
          ...(card.domain === null ? [] : [str("vanity_url", card.domain)]),
          ...(card.description === null ? [] : [str("description", card.description)]),
          ...(card.imageUrl === null
            ? []
            : [
                binding("photo_image_full_size_large", {
                  image_value: { url: card.imageUrl },
                  type: "IMAGE",
                }),
              ]),
        ],
      },
    },
  };
}

/** One post as X's `Tweet` result; `quoted` nests the post it quotes, as X does. */
export function encodeTweet(
  p: EnginePost,
  users: ReadonlyMap<string, EngineUser>,
  quoted?: EnginePost,
): Json {
  // X's raw text: the "Replying to" handles first, the media and quote links last.
  const lead = p.replyingTo.map((h) => `@${h} `).join("");
  const mediaLinks = p.media.map((_, i) => `https://t.co/m${p.postId}x${i}`);
  const quoteLink = p.quotedId === null ? [] : [`https://t.co/q${p.postId}`];
  const tail = [...mediaLinks, ...quoteLink];
  const raw = `${lead}${p.text}${tail.length === 0 ? "" : ` ${tail.join(" ")}`}`;
  const start = codePoints(lead);
  let at = 0;
  const leadMentions = p.replyingTo.map((h) => {
    const indices = [at, at + h.length + 1];
    at += h.length + 2;
    return { screen_name: h, indices };
  });
  const entities = encodeEntities(p.entities, start);
  return {
    __typename: "Tweet",
    rest_id: p.postId,
    core: { user_results: { result: encodeUser(authorOf(p, users)) } },
    views: p.metrics.views === null ? { state: "Enabled" } : { count: String(p.metrics.views) },
    ...encodeCard(p),
    ...when(p.note !== null, () => ({ birdwatch_pivot: { subtitle: { text: p.note } } })),
    ...when(p.aiGenerated, () => ({
      content_disclosure: { ai_generated_disclosure: { has_ai_generated_media: true } },
    })),
    ...when(p.edits.length > 0 || p.editsRemaining !== null || p.editableUntil !== null, () => ({
      edit_control: {
        edit_tweet_ids: p.edits,
        ...when(p.editableUntil !== null, () => ({
          editable_until_msecs: String(Date.parse(p.editableUntil!)),
        })),
        ...when(p.editsRemaining !== null, () => ({ edits_remaining: String(p.editsRemaining) })),
      },
    })),
    ...when(p.translation !== null, () => ({
      grok_translated_post_with_availability: {
        data: {
          translation: p.translation!.text,
          source_language: p.translation!.from,
          entities: encodeEntities(p.translation!.entities, 0),
        },
      },
    })),
    ...when(quoted !== undefined, () => ({
      quoted_status_result: { result: encodeTweet(quoted!, users) },
    })),
    legacy: {
      id_str: p.postId,
      created_at: xDate(p.createdAt),
      full_text: escapeText(raw),
      display_text_range: [start, start + codePoints(p.text)],
      entities: {
        ...entities,
        user_mentions: [...leadMentions, ...(entities.user_mentions as Array<unknown>)],
      },
      ...when(p.media.length > 0, () => ({
        extended_entities: {
          media: p.media.map((m, i) => ({
            type: m.kind === "gif" ? "animated_gif" : m.kind,
            url: mediaLinks[i],
            media_url_https: m.url,
            original_info: { width: m.width, height: m.height },
            ...when(m.altText !== null, () => ({ ext_alt_text: m.altText })),
            ...when(m.kind !== "photo", () => ({
              video_info: {
                ...when(m.durationMs !== null, () => ({ duration_millis: m.durationMs })),
                variants:
                  m.videoUrl === null
                    ? []
                    : [{ content_type: "video/mp4", bitrate: 2_176_000, url: m.videoUrl }],
              },
            })),
          })),
        },
      })),
      favorite_count: p.metrics.likes,
      retweet_count: p.metrics.reposts,
      reply_count: p.metrics.replies,
      quote_count: p.metrics.quotes,
      bookmark_count: p.metrics.bookmarks,
      favorited: p.liked,
      retweeted: p.reposted,
      bookmarked: p.bookmarked,
      ...when(p.replyToId !== null, () => ({
        in_reply_to_status_id_str: p.replyToId,
        in_reply_to_screen_name: p.replyingTo[0],
      })),
      ...when(p.quotedId !== null, () => ({
        is_quote_status: true,
        quoted_status_id_str: p.quotedId,
        quoted_status_permalink: {
          url: quoteLink[0],
          expanded: `https://x.com/i/status/${p.quotedId}`,
          display: `x.com/i/status/${p.quotedId}`,
        },
      })),
    },
  };
}

/**
 * An Article's body as X's reader page sends it in the Article's result: Draft.js blocks, one
 * entity per link, set of images and Markdown, X's entity map as a list, and the images as the
 * Article's own media.
 */
function encodeArticleBody(body: EngineArticle): Json {
  const entityMap: Array<Json> = [];
  const media: Array<Json> = [];
  const entity = (offset: number, length: number, type: string, data: Json) => {
    entityMap.push({ key: String(entityMap.length), value: { type, mutability: "Mutable", data } });
    return { offset, length, key: entityMap.length - 1 };
  };
  const blocks = body.blocks.map((b) => ({
    key: b.key,
    type: b.type,
    text: b.text,
    data: {},
    inlineStyleRanges: b.styles,
    entityRanges: [
      ...b.links.map((l) => entity(l.offset, l.length, "LINK", { url: l.url })),
      ...(b.images.length === 0
        ? []
        : [
            entity(0, 1, "MEDIA", {
              mediaItems: b.images.map((img) => {
                const mediaId = String(1_000 + media.length);
                media.push({
                  media_id: mediaId,
                  media_info: {
                    original_img_url: img.url,
                    original_img_width: img.width,
                    original_img_height: img.height,
                  },
                });
                return { mediaId, localMediaId: mediaId, mediaCategory: "DraftTweetImage" };
              }),
            }),
          ]),
      ...(b.markdown === null ? [] : [entity(0, 1, "MARKDOWN", { markdown: b.markdown })]),
    ],
  }));
  return { content_state: { blocks, entityMap }, media_entities: media };
}

interface Encoder {
  readonly users: ReadonlyMap<string, EngineUser>;
  readonly posts: ReadonlyMap<string, EnginePost>;
}

/** A timeline item for a post: a repost in its reposter's wrapper, other context as X's line. */
function tweetItem(p: EnginePost, x: Encoder): Json {
  const quoted = p.quotedId === null ? undefined : x.posts.get(p.quotedId);
  const tweet = encodeTweet(p, x.users, quoted);
  const reposter =
    p.context?.type === "Retweet"
      ? [...x.users.values()].find((u) => u.handle === p.context!.handle)
      : undefined;
  const result =
    reposter === undefined
      ? tweet
      : {
          __typename: "Tweet",
          rest_id: `1${p.postId}`,
          core: { user_results: { result: encodeUser(reposter) } },
          legacy: {
            id_str: `1${p.postId}`,
            created_at: xDate(p.createdAt),
            full_text: `RT @${p.author.handle}: ${escapeText(p.text)}`,
            favorite_count: 0,
            retweet_count: p.metrics.reposts,
            reply_count: 0,
            quote_count: 0,
            retweeted_status_result: { result: tweet },
          },
        };
  return {
    itemType: "TimelineTweet",
    __typename: "TimelineTweet",
    tweetDisplayType: "Tweet",
    tweet_results: { result },
    ...when(p.context !== null && reposter === undefined, () => ({
      socialContext: {
        type: "TimelineGeneralContext",
        contextType: p.context!.type,
        text: p.context!.text,
        ...when(p.context!.handle !== null, () => ({
          landingUrl: { url: `twitter://user?screen_name=${p.context!.handle}` },
        })),
      },
    })),
    ...when(p.isPromoted, () => ({ promotedMetadata: { advertiser_results: {} } })),
  };
}

const item = (entryId: string, itemContent: Json) => ({
  entryId,
  sortIndex: entryId,
  content: { entryType: "TimelineTimelineItem", __typename: "TimelineTimelineItem", itemContent },
});

/** X's prompt in a timeline, as the Subs tab's subscribe prompt; X links its button on twitter.com. */
const promptItem = (p: EnginePrompt): Json => ({
  __typename: "TimelineMessagePrompt",
  itemType: "TimelineMessagePrompt",
  content: {
    contentType: "TimelineInlinePrompt",
    headerText: p.header,
    bodyText: p.body,
    ...when(p.button !== null, () => ({
      primaryButtonAction: {
        text: p.button!.text,
        action: {
          dismissOnClick: false,
          url: p.button!.url.replace(/^https:\/\/x\.com\//, "https://twitter.com/"),
        },
      },
    })),
  },
});

/** A module: X's box of items under one header (or a thread, `VerticalConversation`). */
const moduleEntry = (
  entryId: string,
  items: ReadonlyArray<{ readonly id: string; readonly content: Json }>,
  extra: Json,
) => ({
  entryId,
  sortIndex: entryId,
  content: {
    entryType: "TimelineTimelineModule",
    __typename: "TimelineTimelineModule",
    ...extra,
    items: items.map((i) => ({ entryId: `${entryId}-${i.id}`, item: { itemContent: i.content } })),
  },
});

const userItem = (u: EngineUser): Json => ({
  itemType: "TimelineUser",
  __typename: "TimelineUser",
  userDisplayType: "User",
  user_results: { result: encodeUser(u) },
});

const cursorEntry = (cursorType: "Top" | "Bottom", value: string) => ({
  entryId: `cursor-${cursorType.toLowerCase()}-${value}`,
  sortIndex: value,
  content: {
    entryType: "TimelineTimelineCursor",
    __typename: "TimelineTimelineCursor",
    cursorType,
    value,
  },
});

/** Runs of neighbours that share a key (a thread, a module header), in order. */
function runs<A>(items: ReadonlyArray<A>, key: (a: A) => string | null) {
  const out: Array<{ key: string | null; items: Array<A> }> = [];
  for (const a of items) {
    const k = key(a);
    const last = out.at(-1);
    if (last !== undefined && last.key === k && k !== null) last.items.push(a);
    else out.push({ key: k, items: [a] });
  }
  return out;
}

function trendItem(t: EngineTrend): Json {
  return {
    itemType: "TimelineTrend",
    __typename: "TimelineTrend",
    name: t.name,
    trend_url: { url: t.url, urlType: "DeepLink" },
    ...when(t.context !== null, () => ({ trend_metadata: { domain_context: t.context } })),
    ...when(t.images.length > 0, () => ({ social_context: { contextImageUrls: t.images } })),
  };
}

function notificationItem(n: EngineNotification, x: Encoder): Json {
  return {
    itemType: "TimelineNotification",
    __typename: "TimelineNotification",
    id: n.id,
    notification_icon: n.icon,
    rich_message: { rtl: false, text: n.text, entities: [] },
    ...when(n.at !== null, () => ({ timestamp_ms: String(Date.parse(n.at!)) })),
    template: {
      __typename: "TimelineNotificationAggregateUserActions",
      from_users: n.users.map((u) => ({ user_results: { result: encodeMini(u) } })),
      target_objects: n.postIds.map((id) => {
        const post = x.posts.get(id);
        return {
          tweet_results: {
            result: post === undefined ? { rest_id: id } : encodeTweet(post, x.users),
          },
        };
      }),
    },
  };
}

function listItem(l: EngineList): Json {
  return {
    itemType: "TimelineTwitterList",
    __typename: "TimelineTwitterList",
    displayType: "List",
    list: encodeList(l),
  };
}

function encodeList(l: EngineList): Json {
  return {
    id_str: l.listId,
    name: l.name,
    description: l.description,
    mode: l.isPrivate ? "Private" : "Public",
    ...when(l.members !== null, () => ({ member_count: l.members })),
    ...when(l.followers !== null, () => ({ subscriber_count: l.followers })),
    ...when(l.bannerUrl !== null, () => ({
      default_banner_media: { media_info: { original_img_url: l.bannerUrl } },
    })),
    ...when(l.owner !== null, () => ({ user_results: { result: encodeMini(l.owner!) } })),
  };
}

/** A Community as X sends it; a field the batch does not know is left out, as a tile leaves most. */
function encodeCommunity(c: EngineCommunity): Json {
  return {
    __typename: "Community",
    id: `Q29tbXVuaXR5OjE${c.communityId}`,
    id_str: c.communityId,
    name: c.name,
    ...when(c.description !== null, () => ({ description: c.description })),
    ...when(c.bannerUrl !== null, () => ({
      default_banner_media: { media_info: { original_img_url: c.bannerUrl } },
    })),
    ...when(c.members !== null, () => ({ member_count: c.members })),
    ...when(c.topic !== null, () => ({
      primary_community_topic: { topic_id: "1", topic_name: c.topic },
    })),
    ...when(c.rules !== null, () => ({
      rules: c.rules!.map((r, i) => ({ rest_id: String(i + 1), ...r })),
    })),
    ...when(c.joinPolicy !== null, () => ({ join_policy: c.joinPolicy })),
    ...when(c.role !== null, () => ({ role: c.role })),
  };
}

/**
 * An NBA game as X's sports calls send it: the score, timeouts and bonus under `live`, the teams
 * under `summary`, the newest play under `plays`. A field the batch does not know is left out.
 */
function encodeGame(g: EngineGame): Json {
  const side = (t: EngineGameTeam) => ({
    ...when(t.abbreviation !== null, () => ({ abbreviation: t.abbreviation })),
    ...when(t.name !== null, () => ({ name: t.name })),
    ...when(t.points !== null, () => ({ points: t.points })),
    team: { id: "VGVhbTox", rest_id: "706000000000000001" },
  });
  const live = (at: "away" | "home", t: EngineGameTeam) => ({
    ...when(t.points !== null, () => ({ [`${at}_points`]: t.points })),
    ...when(t.timeouts !== null, () => ({ [`${at}_timeouts`]: t.timeouts })),
    ...when(t.bonus !== null, () => ({ [`${at}_bonus`]: t.bonus })),
  });
  return {
    id: "R2FtZTox",
    rest_id: g.gameId,
    live: {
      ...live("away", g.away),
      ...live("home", g.home),
      ...when(g.clock !== null, () => ({ clock: g.clock })),
      ...when(g.halftime !== null, () => ({ halftime: g.halftime })),
      ...when(g.period !== null, () => ({ quarter: g.period })),
      ...when(g.periodType !== null, () => ({ period_type: g.periodType })),
      ...when(g.status !== null, () => ({ status: g.status })),
    },
    summary: {
      away: side(g.away),
      home: side(g.home),
      ...when(g.startsAt !== null, () => ({ scheduled_ms: String(Date.parse(g.startsAt!)) })),
      ...when(g.status !== null, () => ({ status: g.status })),
    },
    ...when(g.lastPlay !== null, () => ({
      plays: { periods: [{ plays: [{ ...g.lastPlay, sequence: "1", participants: [] }] }] },
    })),
  };
}

/**
 * A batch's timeline as X's entries: its posts (threads as conversation modules), people, trends,
 * notifications and Lists, each module under its header, between the page's cursors. Every post
 * is an entry, a quote inside the post that quotes it, or a notification's target.
 */
/** X's Radar answers (Relay, ondemand.Insights) sit under the viewer's own user. */
const radarViewer = (fields: Json) => ({
  data: {
    viewer_v2: {
      user_results: { result: { __typename: "User", ...fields, id: "VXNlcjox" }, id: "VXNlcjox" },
    },
  },
});

/**
 * A Radar query in X's shape (`ApiInsightRule`). X's list is newest change first, so the `index`th
 * row changed a minute before the one above it.
 */
const radarRule = (q: EngineRadarQuery, index: number): Json => ({
  rest_id: q.id,
  core: {
    title: q.title,
    tags: null,
    advanced_query: q.query,
    created_at: q.createdAt,
    updated_at: new Date(Date.UTC(2026, 10, 2) - index * 60_000).toISOString(),
    notifications_enabled: false,
  },
  ...when(q.preview.length > 0, () => ({
    preview: {
      counts: q.preview.map((d) => ({ start_time: Date.parse(d.at) / 1000, count: d.count })),
    },
  })),
  id: btoa(`InsightRule:${q.id}`),
});

/** A post in X's Radar list: X's newer shape, text and time in `details`, counts in `counts`. */
const radarTweet = (p: EnginePost, users: ReadonlyMap<string, EngineUser>): Json => {
  const raw = encodeEntities(p.entities, 0);
  return {
    __typename: "Tweet",
    rest_id: p.postId,
    core: { user_results: { result: encodeUser(authorOf(p, users)) } },
    details: {
      display_text_range: [0, codePoints(p.text)],
      full_text: escapeText(p.text),
      created_at_ms: Date.parse(p.createdAt),
      hashtag_entities: raw.hashtags,
      cashtag_entities: raw.symbols,
      smarttags: [],
    },
    legacy: { entities: { timestamps: [] } },
    url_entities: raw.urls,
    mention_entities: raw.user_mentions,
    counts: {
      reply_count: p.metrics.replies,
      favorite_count: p.metrics.likes,
      quote_count: p.metrics.quotes,
      retweet_count: p.metrics.reposts,
      bookmark_count: p.metrics.bookmarks,
    },
    views: { count: String(p.metrics.views ?? 0) },
    id: btoa(`Tweet:${p.postId}`),
  };
};

function timelineEntries(batch: EngineBatch, users: ReadonlyMap<string, EngineUser>) {
  const posts = new Map(batch.posts.map((p) => [p.postId, p]));
  const x: Encoder = { users, posts };
  const entries: Array<Json> = [];
  if (batch.top !== null) entries.push(cursorEntry("Top", batch.top));
  if (batch.prompt !== undefined)
    entries.push(item(`messageprompt-${batch.key ?? "0"}`, promptItem(batch.prompt)));

  const modules = new Map(batch.modules.map((m) => [m.id, m]));
  // A titled box of posts (Explore's Posts For You) holds the posts after it, up to the next module.
  const boxed = new Map<string, Array<EnginePost>>();
  let box: Array<EnginePost> | undefined;
  for (const id of batch.order) {
    const m = modules.get(id);
    if (m === undefined) {
      if (posts.has(id)) box?.push(posts.get(id)!);
      continue;
    }
    box = m.userIds.length === 0 ? [] : undefined;
    if (box !== undefined) boxed.set(id, box);
  }
  const inBox = new Set([...boxed.values()].flat().map((p) => p.postId));
  const listed = batch.order.flatMap((id) =>
    inBox.has(id) ? [] : (posts.get(id) ?? modules.get(id) ?? []),
  );
  for (const run of runs(listed, (e) => ("postId" in e ? (e.conversation?.id ?? null) : null))) {
    const first = run.items[0]!;
    if (!("postId" in first) && first.userIds.length === 0)
      entries.push(
        moduleEntry(
          first.id,
          boxed.get(first.id)!.map((p) => ({ id: `tweet-${p.postId}`, content: tweetItem(p, x) })),
          {
            displayType: "Vertical",
            header: { displayType: "Classic", text: first.title, sticky: false },
            clientEventInfo: { component: "tweets_for_you", element: "module" },
          },
        ),
      );
    else if (!("postId" in first))
      // X's Who to follow among the posts: its header, its people, Show more to the Follow page.
      entries.push(
        moduleEntry(
          first.id,
          first.userIds.flatMap((id) => {
            const u = users.get(id);
            return u === undefined ? [] : [{ id: `user-${id}`, content: userItem(u) }];
          }),
          {
            displayType: "Vertical",
            header: { displayType: "Classic", text: first.title, sticky: false },
            footer: {
              displayType: "Classic",
              text: "Show more",
              landingUrl: { url: "twitter://connect_people", urlType: "DeepLink" },
            },
            clientEventInfo: { component: "suggest_who_to_follow", element: "module" },
          },
        ),
      );
    else if (run.key === null) entries.push(item(`tweet-${first.postId}`, tweetItem(first, x)));
    else
      entries.push(
        moduleEntry(
          run.key,
          run.items.flatMap((p) =>
            "postId" in p ? [{ id: `tweet-${p.postId}`, content: tweetItem(p, x) }] : [],
          ),
          { displayType: "VerticalConversation" },
        ),
      );
  }

  // The Notifications page: a mention or a reply is its post, any other event a notification.
  for (const n of batch.notifications) {
    if (n.kind === "event") {
      entries.push(item(`notification-${n.id}`, notificationItem(n, x)));
      continue;
    }
    const post = posts.get(n.postIds[0] ?? "");
    if (post !== undefined && !batch.order.includes(post.postId))
      entries.push(item(`notification-${n.id}`, tweetItem(post, x)));
  }

  for (const run of runs(batch.trends, (t) => t.group)) {
    if (run.key === null)
      for (const t of run.items) entries.push(item(`trend-${t.name}`, trendItem(t)));
    else
      entries.push(
        moduleEntry(
          `module-${run.key}`,
          run.items.map((t) => ({ id: `trend-${t.name}`, content: trendItem(t) })),
          { displayType: "Vertical", header: { text: run.key } },
        ),
      );
  }

  for (const run of runs(batch.lists, (l) => l.group))
    entries.push(
      moduleEntry(
        `lists-${run.key ?? "all"}`,
        run.items.map((l) => ({ id: `list-${l.listId}`, content: listItem(l) })),
        {
          displayType: "Vertical",
          ...when(run.key !== null, () => ({ header: { text: run.key } })),
        },
      ),
    );

  const cell = (u: EngineUser) => ({
    id: `user-${u.userId}`,
    content: {
      itemType: "TimelineUser",
      __typename: "TimelineUser",
      userDisplayType: "UserConcise",
      user_results: { result: encodeUser(u) },
    },
  });
  // X's titled boxes of people (a Community's Moderators and Members), each with its "Show more".
  for (const [i, section] of batch.sections.entries())
    entries.push(
      moduleEntry(`people-${i}`, section.userIds.flatMap((id) => users.get(id) ?? []).map(cell), {
        displayType: "Vertical",
        header: { displayType: "Classic", text: section.title },
        ...when(section.link !== null, () => ({
          footer: {
            displayType: "Classic",
            text: "Show more",
            landingUrl: { url: section.link, urlType: "ExternalUrl" },
          },
        })),
      }),
    );
  // A people page's own list; the people of a Who to follow among the posts are listed there.
  const inModules = new Set(batch.modules.flatMap((m) => m.userIds));
  const people = batch.people.flatMap((id) => (inModules.has(id) ? [] : (users.get(id) ?? [])));
  if (people.length > 0 && batch.sections.length === 0)
    entries.push(
      moduleEntry(
        "who-to-follow",
        people.map((u) => ({ id: `user-${u.userId}`, content: userItem(u) })),
        { displayType: "Vertical" },
      ),
    );

  if (batch.bottom !== null) entries.push(cursorEntry("Bottom", batch.bottom));
  return entries;
}

const instructions = (entries: ReadonlyArray<Json>) => ({
  instructions: [{ type: "TimelineAddEntries", entries }],
});

const viewerBody = (v: EngineViewer) => ({
  data: {
    viewer: {
      user_results: {
        result: encodeMini({
          userId: v.userId ?? "0",
          handle: v.handle,
          name: v.name ?? v.handle,
          avatarUrl: v.avatarUrl,
        }),
      },
    },
  },
});

const DAY_MS = 86_400_000;
/** X's engagement type for each metric its overview counts; follows come in their own series. */
const ENGAGEMENT_TYPE: Readonly<Record<string, string>> = {
  Bookmark: "Bookmark",
  Impressions: "Displayed",
  Likes: "Fav",
  ProfileVisits: "ProfilePic",
  CreateQuote: "QuoteCreate",
  Retweets: "Retweet",
  Replies: "Reply",
  CreateReply: "ReplyCreate",
  Share: "Share",
  CreateTweet: "TweetCreate",
};
const metricList = (m: EngineMetrics) =>
  Object.entries(m).map(([metric_type, metric_value]) => ({ metric_type, metric_value }));
/** X's analytics answer about the signed-in account, under `viewer_v2` as its Relay queries ask. */
const viewerV2 = (fields: Json) => ({
  data: {
    viewer_v2: {
      user_results: {
        id: btoa("UserResults:you"),
        result: { __typename: "User", id: btoa("User:you"), ...fields },
      },
    },
  },
});

/** X's account analytics answers (x.com/i/account_analytics), for the request's range. */
function encodeAccountAnalytics(a: EngineAccountAnalytics | undefined, variables: Json): Json {
  if (a === undefined) return { data: {} };
  switch (a.kind) {
    case "overview": {
      const from = Date.parse(a.from);
      const rows = (m: EngineMetrics, timestamp: number) =>
        Object.entries(m).flatMap(([metric, count]) => {
          const type = ENGAGEMENT_TYPE[metric];
          return type === undefined
            ? []
            : [{ count, timestamp, engagement_type: type, is_engaging_user_verified: "false" }];
        });
      const follows = (m: EngineMetrics, ms: number) => ({
        metric_values: metricList({ Follows: m.Follows ?? 0, Unfollows: m.Unfollows ?? 0 }),
        timestamp: { iso8601_time: new Date(ms).toISOString() },
      });
      return viewerV2({
        ...when(a.verifiedFollowers !== null, () => ({
          verified_follower_count: a.verifiedFollowers,
          author_follower_metrics: { active_followers: 0, active_verified_followers: 0 },
        })),
        relationship_counts: { followers: a.followers },
        current_time_series: a.daily.flatMap((m, i) => rows(m, from + i * DAY_MS)),
        previous_totals: rows(a.previous, from - a.days * DAY_MS),
        hourly_backfill: [],
        legacy_current_follow_metrics: a.daily.flatMap((m, i) =>
          m.Follows === undefined ? [] : [follows(m, from + i * DAY_MS)],
        ),
        legacy_previous_follow_metrics: [follows(a.previous, from - a.days * DAY_MS)],
      });
    }
    case "content":
      return viewerV2({
        tweets_results: a.posts.map((p) => ({
          rest_id: p.postId,
          result: {
            __typename: "Tweet",
            rest_id: p.postId,
            details: {
              created_at_ms: Date.parse(p.createdAt),
              full_text: p.text,
              display_text_range: [0, [...p.text].length],
            },
            organic_metrics_total: metricList(p.metrics),
            ...when(p.reply, () => ({ reply_to_results: { rest_id: "700000000001" } })),
            ...when(p.community, () => ({ community_results: { rest_id: "600000000103" } })),
          },
        })),
      });
    case "video":
      // One point on the range's last day; X sends one per day, the range before it too.
      return viewerV2({
        media_metrics_time_series_for_publisher: {
          metric_values: [
            {
              timestamp: Number(variables.to_timestamp) + 1 - DAY_MS,
              metric_values: metricList(a.totals),
            },
          ],
        },
      });
    case "videos":
      return viewerV2({
        get_media_filtered: {
          cursor: { offset: a.videos.length },
          media_results: a.videos.map((v) => ({
            result: {
              __typename: "ApiMedia",
              id: btoa(`ApiMedia:${v.mediaKey}`),
              media_key: v.mediaKey,
              video_media_name: v.name,
              public_video_view_count: v.views,
              video_view_count: { __typename: "Count", total: v.views },
              media_info: {
                __typename: "ApiVideo",
                duration_millis: v.durationMs,
                ...when(v.previewUrl !== null, () => ({
                  preview_image: { original_img_url: v.previewUrl },
                })),
              },
              get_media_posts_results:
                v.postId === null
                  ? []
                  : [{ rest_id: v.postId, result: { __typename: "Tweet", rest_id: v.postId } }],
            },
          })),
        },
      });
    case "audience": {
      const timestamp = Number(variables.from_time_incl);
      return viewerV2({
        uec_metrics_daily_time_series_count: a.rows
          .filter((r) => r.country === null)
          .map((r) => ({
            age: r.age,
            gender: r.gender,
            engagement_type: r.type,
            count: r.count,
            timestamp,
            is_in_network: null,
            client_app_id: r.app === null ? null : Number(r.app),
          })),
        uec_country_metrics_daily_time_series_count: a.rows
          .filter((r) => r.country !== null)
          .map((r) => ({ country: r.country, count: r.count, engagement_type: r.type, timestamp })),
        organic_metrics_time_series: [],
      });
    }
  }
}

/** A bookmark folder in X's BookmarkCollection shape, its picture under `media` when it has one. */
export const encodeFolder = (f: EngineBookmarkFolder): Json => ({
  __typename: "BookmarkCollection",
  id: f.folderId,
  name: f.name,
  ...when(f.imageUrl !== null, () => ({ media: { media_info: { original_img_url: f.imageUrl } } })),
});

/**
 * The body X answers `batch.op` with, each operation under its own path in `data` as x.com sends
 * it; `everyone` names the authors the batch does not, and `variables` are the request's. Calls no
 * screen lists answer `{ data: {} }`.
 */
export function encodeBody(
  batch: EngineBatch,
  everyone: ReadonlyMap<string, EngineUser> = new Map(),
  variables: Json = {},
): Json {
  // The batch's own record of a person wins: a page can show them as it saw them.
  const users = new Map([...everyone, ...batch.users.map((u) => [u.userId, u] as const)]);
  const timeline = () => instructions(timelineEntries(batch, users));
  switch (batch.op) {
    case "Viewer":
      return batch.viewer === null ? { data: {} } : viewerBody(batch.viewer);
    case "HomeTimeline":
    case "HomeLatestTimeline":
      return { data: { home: { home_timeline_urt: timeline() } } };
    case "GifSearch":
      return {
        data: {
          gif_search_slice: {
            items: (batch.gifs ?? []).map((g) => {
              const image = {
                url: g.url,
                still_image_url: g.stillUrl,
                width: g.width,
                height: g.height,
              };
              return {
                id: g.id,
                alt_text: g.altText,
                provider: { id: "giphy", display_name: g.provider },
                preview_image: image,
                full_image: image,
                thumbnail_images: [image],
              };
            }),
            slice_info: batch.bottom === null ? {} : { next_cursor: batch.bottom },
          },
        },
      };
    case "TweetDetail":
      return { data: { threaded_conversation_with_injections_v2: timeline() } };
    case "UserByScreenName": {
      const user = batch.users[0];
      return { data: { user: user === undefined ? {} : { result: encodeUser(user) } } };
    }
    case "SearchTimeline":
      return { data: { search_by_raw_query: { search_timeline: { timeline: timeline() } } } };
    case "Bookmarks":
      return { data: { bookmark_timeline_v2: { timeline: timeline() } } };
    case "NotificationsTimeline":
      return {
        data: {
          viewer_v2: {
            user_results: { result: { notification_timeline: { timeline: timeline() } } },
          },
        },
      };
    case "ExplorePage":
      return {
        data: {
          explore_page: {
            body: {
              timelines: (batch.exploreTabs ?? []).map((t) => ({
                id: t.id,
                labelText: t.label,
                timeline: { id: t.timelineId },
              })),
              initialTimeline: { id: "for_you", timeline: { timeline: timeline() } },
            },
          },
        },
      };
    case "CarouselQuery":
      return {
        data: {
          viewer_v2: {
            user_results: {
              result: {
                __typename: "User",
                community_memberships_slice: {
                  items_results: batch.communities.map((c) => ({ result: encodeCommunity(c) })),
                },
              },
            },
          },
        },
      };
    case "CommunitiesRankedTimeline":
      return { data: { viewer: { ranked_communities_timeline: { timeline: timeline() } } } };
    case "CommunitiesExploreTimeline":
      return { data: { viewer: { explore_communities_timeline: { timeline: timeline() } } } };
    case "CommunityQuery":
    case "CommunitiesFetchOneQuery": {
      const c = batch.communities[0];
      return { data: { communityResults: c === undefined ? {} : { result: encodeCommunity(c) } } };
    }
    case "CommunityTweetsTimeline":
      return {
        data: {
          communityResults: { result: { ranked_community_timeline: { timeline: timeline() } } },
        },
      };
    case "CommunityMediaTimeline":
      return {
        data: {
          communityResults: { result: { community_media_timeline: { timeline: timeline() } } },
        },
      };
    case "CommunityAboutTimeline":
      return {
        data: {
          communityResults: { result: { about_timeline: { timeline: timeline() } } },
        },
      };
    case "CommunityTweetSearchModuleQuery":
      return {
        data: {
          communityResults: {
            result: {
              community_filtered_timeline: {
                timeline: {
                  id: "CommunitySearchTopProduct-Timeline",
                  instructions: [
                    { type: "TimelineClearCache" },
                    ...instructions(timelineEntries(batch, users)).instructions,
                  ],
                },
              },
            },
          },
        },
      };
    case "TweetResultByRestId": {
      // X's reader page: the post, its Article's body inside the result its card is read from.
      const p = batch.posts[0];
      if (p === undefined) return { data: { tweetResult: {} } };
      const tweet = encodeTweet(p, users);
      const body = batch.articles?.find((a) => a.postId === p.postId);
      const article = (tweet.article as { article_results: { result: Json } } | undefined)
        ?.article_results.result;
      return {
        data: {
          tweetResult: {
            result:
              body === undefined || article === undefined
                ? tweet
                : {
                    ...tweet,
                    article: {
                      article_results: { result: { ...article, ...encodeArticleBody(body) } },
                    },
                  },
          },
        },
      };
    }
    case "CommunitiesSearchQuery":
      return {
        data: {
          communities_search_slice: {
            // X names each Community it finds by `rest_id`.
            items_results: batch.communities.map((c) => {
              const { id_str: _, ...found } = encodeCommunity(c);
              return { id: found.id, result: { ...found, rest_id: c.communityId } };
            }),
            slice_info: batch.bottom === null ? {} : { next_cursor: batch.bottom },
          },
        },
      };
    case "GlobalCommunitiesPostSearchTimeline":
    case "GlobalCommunitiesLatestPostSearchTimeline":
      return {
        data: {
          search_by_raw_query: {
            [batch.op === "GlobalCommunitiesPostSearchTimeline"
              ? "communities_posts_search_page"
              : "communities_latest_posts_search_page"]: {
              timeline: {
                instructions: [{ type: "TimelineClearCache" }, ...timeline().instructions],
              },
            },
          },
        },
      };
    case "UserSportsProfile": {
      const games = batch.games ?? [];
      return {
        data: {
          user_results: {
            rest_id: batch.key,
            result: {
              __typename: "User",
              rest_id: batch.key,
              // Only a team's profile carries a schedule.
              ...when(games.length > 0, () => ({
                sports_profile: {
                  league: "NBA",
                  season_schedule: {
                    games: games.map((g) => ({
                      game: { __typename: "SportsProfileNbaGame", nba_game: encodeGame(g) },
                    })),
                  },
                },
              })),
            },
          },
        },
      };
    }
    case "NBASchedule":
      return { data: { nba_schedule: { games: (batch.games ?? []).map(encodeGame) } } };
    case "NBAGameHydrate":
    case "NBALiveGame": {
      const g = batch.games?.[0];
      return { data: { nba_game: g === undefined ? {} : encodeGame(g) } };
    }
    case "SportsGameTopTimeline":
      return { data: { sports_timelines: { top: { id: "U3BvcnRzOjE=", timeline: timeline() } } } };
    case "SportsGameLatestTimeline":
      return {
        data: { sports_timelines: { latest: { id: "U3BvcnRzOjI=", timeline: timeline() } } },
      };
    case "GenericTimelineById":
      return { data: { timeline: { timeline: timeline() } } };
    case "ListsManagementPageTimeline":
      return { data: { viewer: { list_management_timeline: { timeline: timeline() } } } };
    case "ListByRestId": {
      const list = batch.lists[0];
      return { data: { list: list === undefined ? {} : encodeList(list) } };
    }
    case "ListLatestTweetsTimeline":
      return { data: { list: { tweets_timeline: { timeline: timeline() } } } };
    case "ListMembers":
      return { data: { list: { members_timeline: { timeline: timeline() } } } };
    case "ListSubscribers":
      return { data: { list: { subscribers_timeline: { timeline: timeline() } } } };
    case "Retweeters":
      return { data: { retweeters_timeline: { timeline: timeline() } } };
    case "Favoriters":
      return { data: { favoriters_timeline: { timeline: timeline() } } };
    case "ConnectTabTimeline":
      return { data: { connect_tab_timeline: { timeline: timeline() } } };
    case "BlueVerifiedFollowers":
    case "FollowersYouKnow":
    case "Followers":
    case "Following":
      return {
        data: { user: { result: { __typename: "User", timeline: { timeline: timeline() } } } },
      };
    case "TweetActivityQuery": {
      // X's own shape: a grid of metrics, a zero's value left out, beside the promoted numbers.
      const id = btoa(`Tweet:${batch.key ?? ""}`);
      return {
        data: {
          tweet_result_by_rest_id: {
            id,
            result: {
              __typename: "Tweet",
              id,
              datapoints_grid: Object.entries(batch.analytics ?? {}).map(([metric_type, value]) =>
                value === 0 ? { metric_type } : { metric_type, metric_value: value },
              ),
              promotion_info: [{ metric_type: "Impressions" }],
              video: [],
            },
          },
        },
      };
    }
    case "PinnedTimelines":
      return {
        data: {
          pinned_timelines: {
            pinned_timelines: (batch.homeTabs ?? []).map((t) =>
              t.id.startsWith("tag:")
                ? { __typename: "TagPinnedTimeline", tag: t.id.slice(4), tab_label: t.label }
                : t.id.startsWith("community:")
                  ? {
                      __typename: "CommunityPinnedTimeline",
                      community_results: {
                        result: { id_str: t.id.slice("community:".length), name: t.label },
                      },
                    }
                  : {
                      __typename: "ListPinnedTimeline",
                      list: { id_str: t.id.slice(5), name: t.label },
                    },
            ),
          },
        },
      };
    // X's claims for the account (main's GetUserClaims): one per plan, its features as resources.
    case "accountOverviewDailyQuery":
    case "contentPageQuery":
    case "mediaMetricsQuery":
    case "videoListProviderQuery":
    case "audienceOverviewDataQuery":
      return encodeAccountAnalytics(batch.accountAnalytics, variables);
    case "GetUserClaims":
      return {
        data: {
          viewer_v2: {
            claims:
              (batch.claims ?? []).length === 0
                ? []
                : [
                    {
                      rest_id: "premium-basic",
                      origin: "Commerce",
                      resources: (batch.claims ?? []).map((f) => ({
                        rest_id: `client_feature_switch/${f}/true`,
                      })),
                    },
                  ],
          },
        },
      };
    case "BookmarkFoldersSlice":
      return {
        data: {
          viewer: {
            user_results: {
              result: {
                __typename: "User",
                bookmark_collections_slice: {
                  items:
                    batch.bookmarkFolders?.kind === "list"
                      ? batch.bookmarkFolders.folders.map(encodeFolder)
                      : [],
                  slice_info: {},
                },
              },
            },
          },
        },
      };
    case "BookmarkFolderTimeline":
      return { data: { bookmark_collection_timeline: { timeline: timeline() } } };
    case "insightsConfigQuery":
      return radarViewer({
        insights_config: {
          __typename: "InsightsConfigSuccess",
          allow_build_query: false,
          allow_granularity: ["Day"],
          allow_impressions: false,
          allow_post_counts: true,
          allow_unique_users: false,
          saved_query_limit: batch.radarLimit ?? 0,
          subscription_type: "PremiumPlus",
          time_range_limit_days: 7,
          allow_alert_notifications: false,
          alerts_enabled_by_default: false,
        },
      });
    case "insightsListContextQuery":
      return radarViewer({ insight_rules: { items: (batch.radarQueries ?? []).map(radarRule) } });
    case "insightProviderGetQuery": {
      const q = batch.radarQueries?.[0];
      return radarViewer({ insight_rule_by_id: q === undefined ? null : radarRule(q, 0) });
    }
    case "usePostCountQuery": {
      const days = batch.radarCounts ?? [];
      return radarViewer({
        insight_rule_by_id: {
          matched_post_counts: {
            __typename: "InsightsMatchedPostCountsSuccess",
            counts: days.map((d) => ({ count: d.count, start_time: Date.parse(d.at) / 1000 })),
            has_incomplete_counts: false,
            oldest_complete_count: null,
            total: days.reduce((n, d) => n + (d.count ?? 0), 0),
          },
          id: btoa(`InsightRule:${batch.key ?? ""}`),
        },
      });
    }
    case "postListQuery":
      return {
        data: {
          search_by_raw_query: {
            search_timeline: {
              timeline: {
                instructions: [
                  {
                    __typename: "TimelineAddEntries",
                    entries: batch.posts.map((p) => ({
                      content: {
                        __typename: "TimelineTimelineItem",
                        content: {
                          __typename: "TimelineTweet",
                          tweet_results: { rest_id: p.postId, result: radarTweet(p, users) },
                        },
                      },
                    })),
                  },
                ],
              },
            },
            id: "U2VhcmNoUXVlcnk6",
          },
        },
      };
    default:
      // A profile's tabs (UserTweets, UserMedia...) share one path.
      if (batch.op.startsWith("User"))
        return {
          data: { user: { result: { __typename: "User", timeline: { timeline: timeline() } } } },
        };
      return { data: {} };
  }
}

import type {
  EngineBatch,
  EngineBookmarkFolder,
  EngineCommunity,
  EngineGif,
  EngineHomeTab,
  EngineList,
  EnginePost,
  EngineRadarCount,
  EngineRadarQuery,
  EngineTrend,
  EngineUser,
} from "@xtend/contracts";

import { synth } from "../../../web/src/components/xnative/engineFixtures.ts";
import { encodeBody, encodeFolder, encodeTweet } from "./graphql.ts";

/**
 * What mock X knows: the people and posts of the made-up engine fixtures (`synth()`), the pages
 * beyond them (next pages, other reply orders, profile and search tabs, a List's people, pinned
 * Home tabs), and what the user's presses changed. Each GraphQL request is answered from here,
 * and every page the mock draws reads the same batch, so X's page and its responses agree.
 */

export type Json = Record<string, unknown>;

/** One GraphQL call as X's page makes it. */
export interface GraphqlRequest {
  readonly op: string;
  readonly variables: Json;
}

/** Something the page or a write did, in order: the press log tests read. */
interface Press {
  /** `press` is a button, menu or row the page saw clicked; `write` a change X would save. */
  readonly kind: "press" | "write";
  /** A test id (`bookmark`, `786-follow`), `menu:<spec>`, `row:<label>`, or a write's operation. */
  readonly name: string;
  readonly target: string | null;
  /** The page it happened on. */
  readonly path: string;
}

/** Mirrors `quotesQuery` in apps/web/src/state/engine.ts: the search X's Quotes tab runs. */
export const quotesQuery = (postId: string) =>
  `quoted_tweet_id:${postId} OR url:"status/${postId}/video" OR url:"status/${postId}/photo"`;

/** X's Inspiration filters, in X's order: the label X's button draws, the value it asks with. */
export const INSPIRATION_FILTERS = {
  period: [
    { id: "Daily", label: "Last 24h" },
    { id: "Weekly", label: "Last 7d" },
    { id: "Monthly", label: "Last 30d" },
  ],
  engagement: [
    { id: "Likes", label: "Most Likes", metric: "likes" },
    { id: "Replies", label: "Most Replies", metric: "replies" },
    { id: "Quotes", label: "Most Quotes", metric: "quotes" },
    { id: "Bookmarks", label: "Most Bookmarks", metric: "bookmarks" },
    { id: "Shares", label: "Most Shares", metric: "reposts" },
    { id: "VideoQualityViews", label: "Most Video Views", metric: "views" },
  ],
} as const;

/**
 * The timelineId X's Inspiration asks GenericTimelineById for: base64 of "Timeline:" and a thrift
 * struct (field 202) of the engagement (1), language (2) and period (6), as on x.com.
 */
export const inspirationTimelineId = (engagement: string, period: string, language = "en") => {
  const field = (id: number, value: string) => {
    const head = Buffer.alloc(7);
    head[0] = 11;
    head.writeUInt16BE(id, 1);
    head.writeUInt32BE(value.length, 3);
    return [head, Buffer.from(value, "latin1")];
  };
  return Buffer.concat([
    Buffer.from("Timeline:\x0c\x00\xca", "latin1"),
    ...field(1, engagement),
    ...field(2, language),
    ...field(6, period),
    Buffer.from([0, 0]),
  ]).toString("base64");
};

const MORE_TEXT = [
  "Your first hundred users come from conversations, not campaigns.",
  "Wrote the docs before the code this time. Shipping felt calmer.",
  "Pricing page rewrite: one plan, one button, conversion up a third.",
  "If a feature needs a tutorial, it needs a redesign first.",
  "Small teams win by saying no to the third priority.",
  "Our status page gets more visits than the blog. Noted.",
  "A changelog entry a day keeps churn away.",
  "Onboarding emails: shorter, plainer, sent by a person.",
  "We deleted half our settings. Nobody asked for them back.",
  "Ship on Tuesday, write about it on Thursday.",
  "Support tickets are the roadmap you did not have to write.",
  "Default to public. Most of what you build in private is guessing.",
  "The best metric is the one you check without being asked.",
  "Ran our first user interviews over voice notes. Better answers.",
  "Every launch post should say who it is not for.",
  "Fewer dashboards, more phone calls.",
  "Cut the free trial to seven days. Activation went up.",
  "Hiring note: the portfolio beats the resume, every time.",
] as const;

/** The range X's Radar page asks a query's days and posts for: the last 7 days, by UTC day. */
export const radarRange = (now = Date.now()) => {
  const to = Math.floor(now / 86_400_000 + 1) * 86_400;
  const from = to - 7 * 86_400;
  return { from, to, since: new Date(from * 1000).toISOString().slice(0, 10) };
};

const FEEDS = ["forYou", "following"] as const;
export type Feed = (typeof FEEDS)[number];
/** How many pages each Home feed has before X runs out; the rest of the mock's lists have one. */
const FEED_PAGES: Readonly<Record<Feed, number>> = { forYou: 3, following: 2 };
const PAGE_SIZE = 6;

/** A longer For you than the screens need, as the scroll bench reads one: X's page is about 20 posts. */
export interface MockOptions {
  readonly forYouPages?: number;
  readonly pageSize?: number;
  /** Every nth made-up post carries a photo, so a page is as tall as X's. */
  readonly photoEvery?: number;
  /** Whether @you has Premium (X's claims, folders, analytics); X's analytics draw its upsell without. */
  readonly premium?: boolean;
  /** False: X's page sends no claims at boot, as live X did not for one account (2026-11-03). */
  readonly sendsClaims?: boolean;
  /**
   * X's composer lets the account bold and italicize (Premium's write gate): its editor drawn
   * uncapped and its ⌘B and ⌘I applied. It adds no claim: live X may never send GetUserClaims.
   */
  readonly formatting?: boolean;
}

const DAY_MS = 86_400_000;
const msOf = (v: unknown) => (typeof v === "number" ? v : Date.parse(String(v)));
const span = (from: unknown, to: unknown) => Math.round((msOf(to) - msOf(from)) / DAY_MS);
/** The range each of X's account analytics queries asked for, as the capture keys its answer. */
const ACCOUNT_ANALYTICS_KEYS: Readonly<Record<string, (v: Json) => string>> = {
  accountOverviewDailyQuery: (v) => `overview:${span(v.current_from, v.current_to)}`,
  contentPageQuery: (v) => `content:${span(v.from_time, v.to_time)}`,
  mediaMetricsQuery: (v) => `video:${Math.round(span(v.from_timestamp, v.to_timestamp) / 2)}`,
  videoListProviderQuery: () => "videos",
  audienceOverviewDataQuery: (v) => `audience:${span(v.from_time_incl, v.to_time_excl)}`,
};
const PINNED_TAG = "1540000000000000001";
/** X's claim for bookmark folders (GetUserClaims), as `FOLDERS_CLAIM` in apps/web/src/state/engine.ts. */
const FOLDERS_CLAIM = "subscriptions_feature_1002";
/** X's claim for account analytics, as `ANALYTICS_CLAIM` in apps/web/src/state/engine.ts. */
const ANALYTICS_CLAIM = "subscriptions_feature_account_analytics";

const key = (op: string, k: string | null) => `${op}|${k ?? ""}`;
const s = (variables: Json, name: string) =>
  typeof variables[name] === "string" ? (variables[name] as string) : undefined;

/** One mock X: its state, and the answers and pages read from it. */
export function createMockState(options: MockOptions = {}) {
  const pages = { ...FEED_PAGES, forYou: options.forYouPages ?? FEED_PAGES.forYou };
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const fixtures = synth();
  const batches = Object.values(fixtures).flatMap((f) => f.batches);
  const snapshot = new Map(batches.map((b) => [key(b.op, b.key), b]));
  const fixture = (op: string, k: string | null) => snapshot.get(key(op, k));
  const home = fixtures.home!.batches;
  const viewer = home.find((b) => b.viewer !== null)!.viewer!;

  const basePosts = new Map<string, EnginePost>();
  const baseUsers = new Map<string, EngineUser>();
  for (const b of batches) {
    for (const p of b.posts) if (!basePosts.has(p.postId)) basePosts.set(p.postId, p);
    for (const u of b.users) if (!baseUsers.has(u.userId)) baseUsers.set(u.userId, u);
  }
  // The user is no one X lists or suggests: the fixtures name them only as their own posts' author.
  const people = [...baseUsers.values()].filter((u) => u.userId !== viewer.userId);
  const forYou = fixture("HomeTimeline", null)!;
  const following = fixture("HomeLatestTimeline", null)!;

  // Made-up posts past the fixtures' first pages, by the same people.
  let made = 0;
  const photo = [...basePosts.values()].find((p) => p.media.length > 0)!.media.slice(0, 1);
  const make = (minutesAgo: number, extra: Partial<EnginePost> = {}): EnginePost => {
    const n = made++;
    // Its own text: a base post's bold and italic would land on the wrong words.
    const { styles: _, ...base } = forYou.posts[n % forYou.posts.length]!;
    const author = people[(n * 3) % people.length]!;
    const views = 2_000 + ((n * 7_717) % 60_000);
    const post: EnginePost = {
      ...base,
      postId: String(710_000_000_000 + n),
      author: {
        userId: author.userId,
        handle: author.handle,
        name: author.name,
        followers: author.followers,
        verified: author.verified,
      },
      avatarUrl: author.avatarUrl,
      text: MORE_TEXT[n % MORE_TEXT.length]!,
      createdAt: new Date(Date.parse(base.createdAt) - minutesAgo * 60_000).toISOString(),
      metrics: {
        views,
        likes: Math.round(views / 35),
        reposts: Math.round(views / 300),
        replies: Math.round(views / 250),
        quotes: Math.round(views / 1_500),
        bookmarks: Math.round(views / 200),
      },
      ...(options.photoEvery !== undefined && n % options.photoEvery === 0
        ? { media: photo, hasMedia: true }
        : { media: [], hasMedia: false }),
      hasLink: false,
      card: null,
      poll: null,
      note: null,
      context: null,
      translation: null,
      aiGenerated: false,
      liked: false,
      reposted: false,
      bookmarked: false,
      ...extra,
    };
    basePosts.set(post.postId, post);
    return post;
  };
  /** Each feed's pages after its first, made once so a page reads the same every time. */
  const morePages: Record<Feed, ReadonlyArray<ReadonlyArray<EnginePost>>> = {
    forYou: Array.from({ length: pages.forYou - 1 }, (_, page) =>
      Array.from({ length: pageSize }, (_, i) => make(400 + page * 600 + i * 40)),
    ),
    following: Array.from({ length: pages.following - 1 }, (_, page) =>
      Array.from({ length: pageSize }, (_, i) => make(500 + page * 600 + i * 45)),
    ),
  };
  const pinnedTopic = Array.from({ length: 4 }, (_, i) => make(30 + i * 20));
  const focal = fixture("TweetDetail", fixtures.post!.batches[0]!.key)!;
  // Quotes of the post the fixtures' quote quotes, so its Post activity lists more than one.
  const quotedId = following.posts.find((p) => p.quotedId !== null)!.quotedId!;
  for (const i of [0, 1]) make(60 + i * 30, { quotedId });

  // What the user's presses changed, laid over every page that shows the post or person.
  const postChanges = new Map<string, Partial<EnginePost>>();
  const userChanges = new Map<string, Partial<EngineUser>>();
  const bell = new Set<string>();
  const arrived: Record<Feed, Array<EnginePost>> = { forYou: [], following: [] };
  const bookmarks = fixture("Bookmarks", "bookmarks")!.posts.map((p) => p.postId);
  const presses: Array<Press> = [];
  const hiddenTrends = new Map<string, Set<string>>();

  const livePost = (p: EnginePost): EnginePost => ({ ...p, ...postChanges.get(p.postId) });
  const liveUser = (u: EngineUser): EngineUser => ({ ...u, ...userChanges.get(u.userId) });
  const post = (id: string) => {
    const p = basePosts.get(id);
    return p === undefined ? undefined : livePost(p);
  };
  const user = (id: string) => {
    const u = baseUsers.get(id) ?? (id === viewer.userId ? viewerUser() : undefined);
    return u === undefined ? undefined : liveUser(u);
  };
  const byHandle = (handle: string) =>
    [...baseUsers.values(), viewerUser()].find((u) => u.handle === handle.toLowerCase());
  const viewerUser = (): EngineUser => ({
    ...people[0]!,
    userId: viewer.userId!,
    handle: viewer.handle,
    name: viewer.name ?? viewer.handle,
    avatarUrl: viewer.avatarUrl,
    bio: "Trying Xtend on a mock X.",
    youFollow: false,
    followsYou: false,
    pinnedPostId: null,
    verifiedType: null,
    avatarShape: "Circle",
  });
  const liveUsers = () => new Map(people.map((u) => [u.userId, liveUser(u)]));
  const allPosts = () => [...basePosts.values()].map(livePost);

  /** A batch the fixtures hold, with what the user changed since. */
  const live = (b: EngineBatch): EngineBatch => ({
    ...b,
    posts: b.posts.map(livePost),
    users: b.users.map(liveUser),
  });
  /** A page the fixtures do not hold, in the shape the capture reads. */
  const page = (
    op: string,
    k: string | null,
    posts: ReadonlyArray<EnginePost>,
    extra: Partial<EngineBatch> = {},
  ): EngineBatch => ({
    op,
    key: k,
    cursor: null,
    top: `top-${op}-${k ?? ""}`,
    bottom: null,
    posts: posts.map(livePost),
    users: [],
    people: [],
    sections: [],
    order: posts.filter((p) => !posts.some((q) => q.quotedId === p.postId)).map((p) => p.postId),
    modules: [],
    trends: [],
    notifications: [],
    lists: [],
    communities: [],
    homeTabs: null,
    exploreTabs: null,
    viewer: null,
    ...extra,
  });
  const ofPeople = (op: string, k: string, users: ReadonlyArray<EngineUser>) =>
    page(op, k, [], { users: users.map(liveUser), people: users.map((u) => u.userId) });

  /** Home's first page: what arrived since on top, then the fixture's. */
  const feedFirst = (feed: Feed): EngineBatch => {
    const b = live(feed === "forYou" ? forYou : following);
    const fresh = arrived[feed].map(livePost);
    return fresh.length === 0
      ? b
      : { ...b, posts: [...fresh, ...b.posts], order: [...fresh.map((p) => p.postId), ...b.order] };
  };
  /** Page `n` (2 and on) of a Home feed, asked for with the cursor the page before it ended on. */
  const feedPage = (feed: Feed, n: number): EngineBatch => {
    const first = feed === "forYou" ? forYou : following;
    const posts = morePages[feed][n - 2] ?? [];
    return {
      ...page(first.op, first.key, posts),
      top: first.top,
      bottom: n < pages[feed] ? `${first.bottom}#p${n + 1}` : null,
    };
  };
  /** Which page of a feed a cursor asks for: the fixture's bottom is page 2. */
  const pageOf = (first: EngineBatch, cursor: string | undefined) => {
    if (cursor === undefined || cursor === "") return 1;
    if (cursor === first.bottom) return 2;
    const n = /#p(\d+)$/.exec(cursor)?.[1];
    return n === undefined || !cursor.startsWith(`${first.bottom}#p`) ? null : Number(n);
  };

  const replies = focal.posts.slice(1);
  const threadOf = (id: string, mode: string | undefined): EngineBatch | null => {
    const p = post(id);
    if (p === undefined) return null;
    const k = mode === undefined || mode === "Relevance" ? id : `${id}:${mode}`;
    if (id === focal.key) {
      if (k === id) return live(focal);
      const sorted = replies
        .map(livePost)
        .toSorted((a, b) =>
          mode === "Likes"
            ? b.metrics.likes - a.metrics.likes
            : Date.parse(b.createdAt) - Date.parse(a.createdAt),
        );
      return {
        ...live(focal),
        key: k,
        posts: [livePost(focal.posts[0]!), ...sorted],
        top: `top-TweetDetail-${k}`,
        bottom: `bottom-TweetDetail-${k}`,
        order: [id, ...sorted.map((r) => r.postId)],
      };
    }
    const under = allPosts().filter((r) => r.replyToId === id);
    const above = p.replyToId === null ? [] : [post(p.replyToId)].flatMap((a) => a ?? []);
    const shown = [...above, p, ...under];
    return { ...page("TweetDetail", k, shown), order: shown.map((r) => r.postId) };
  };

  const profileTab = (op: string, u: EngineUser): EngineBatch => {
    const own = fixture(op, u.userId);
    if (own !== undefined) return live(own);
    // Others' posts in the person's repost wrappers, as X's Reposts tab lists them.
    if (op === "UserRepostsTimeline")
      return page(
        op,
        u.userId,
        allPosts()
          .filter((p) => p.author.userId !== u.userId && p.quotedId === null && p.context === null)
          .slice(0, 3)
          .map((p) => ({
            ...p,
            context: { type: "Retweet", text: `${u.name} reposted`, handle: u.handle },
          })),
      );
    // A creator's Subs to someone who does not subscribe: X's prompt in place of posts.
    if (op === "UserSuperFollowTweets")
      return page(op, u.userId, [], {
        prompt: {
          header: "Unlock more with Subscriptions",
          body: `@${u.handle} has shared 12 Subscriber-only posts. Subscribe to see their exclusive posts and bonus content.`,
          button: { text: "Subscribe", url: `https://x.com/${u.handle}/superfollows/subscribe` },
        },
      });
    const theirs = allPosts().filter((p) => p.author.userId === u.userId);
    const picked =
      op === "UserMedia"
        ? theirs.filter((p) => p.hasMedia)
        : op === "UserTweetsAndReplies"
          ? theirs
          : op === "UserTweets"
            ? theirs.filter((p) => !p.isReply)
            : [];
    // The fixture's posts tab lists only top-level posts; Replies adds the rest.
    const withFixture =
      op === "UserTweetsAndReplies"
        ? [...(fixture("UserTweets", u.userId)?.posts ?? []).map(livePost), ...picked]
        : picked;
    const unique = [...new Map(withFixture.map((p) => [p.postId, p])).values()];
    return page(op, u.userId, unique);
  };

  const search = (product: string, rawQuery: string): EngineBatch => {
    const k = `${product}:${rawQuery}`;
    const own = fixture("SearchTimeline", k);
    if (own !== undefined) return live(own);
    const quoted = /^quoted_tweet_id:(\d+)/.exec(rawQuery)?.[1];
    if (quoted !== undefined)
      return page(
        "SearchTimeline",
        k,
        allPosts().filter((p) => p.quotedId === quoted),
      );
    const words = rawQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const hits = allPosts().filter((p) => words.some((w) => p.text.toLowerCase().includes(w)));
    const found = hits.length > 0 ? hits : allPosts().slice(0, 8);
    if (product === "People") {
      const who = people.filter((u) =>
        words.some((w) => `${u.name} ${u.handle} ${u.bio}`.toLowerCase().includes(w)),
      );
      return ofPeople("SearchTimeline", k, who.length > 0 ? who : people.slice(0, 5));
    }
    if (product === "Media")
      return page(
        "SearchTimeline",
        k,
        found.filter((p) => p.hasMedia),
      );
    if (product === "Latest")
      return page(
        "SearchTimeline",
        k,
        found.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      );
    return page("SearchTimeline", k, found);
  };

  /**
   * X's Inspiration for the filters a timelineId names: the period's share of the newest posts (a
   * day a third, a week two thirds, a month all), by the engagement's count; null for another id.
   */
  const inspiration = (timelineId: string): EngineBatch | null => {
    const { period, engagement } = INSPIRATION_FILTERS;
    const [p, e] =
      period
        .flatMap((p, i) => engagement.map((e) => [{ ...p, share: (i + 1) / 3 }, e] as const))
        .find(([p, e]) => inspirationTimelineId(e.id, p.id) === timelineId) ?? [];
    if (p === undefined || e === undefined) return null;
    const newest = allPosts().toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const top = newest
      .slice(0, Math.ceil(newest.length * p.share))
      .toSorted((a, b) => (b.metrics[e.metric] ?? 0) - (a.metrics[e.metric] ?? 0))
      .slice(0, 20);
    return page("GenericTimelineById", `inspiration:${e.id}:${p.id}:en`, top);
  };

  // X's Radar (Premium): off for the account until a test turns it on, as for most accounts. Its
  // queries newest change first, as X's list sorts them.
  const radar = {
    premium: false,
    limit: 3,
    next: 1803,
    queries: [
      { id: "1802", title: "", query: "design system", createdAt: "2026-10-30T09:00:00.000Z" },
      {
        id: "1801",
        title: "Growth",
        query: "growth OR ads",
        createdAt: "2026-10-28T09:00:00.000Z",
      },
    ] as Array<Omit<EngineRadarQuery, "preview">>,
  };
  const radarHits = (query: string) => {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return allPosts().filter((p) => words.some((w) => p.text.toLowerCase().includes(w)));
  };
  /** A query's posts per UTC day in `[from, to)` (seconds), plus a steady made-up base. */
  const radarDays = (id: string, from: number, to: number): ReadonlyArray<EngineRadarCount> => {
    const query = radar.queries.find((q) => q.id === id)?.query ?? "";
    const hits = radarHits(query).map((p) => Date.parse(p.createdAt) / 1000);
    return Array.from({ length: Math.max(0, Math.round((to - from) / 86_400)) }, (_, i) => {
      const start = from + i * 86_400;
      const own = hits.filter((t) => t >= start && t < start + 86_400).length;
      return { at: new Date(start * 1000).toISOString(), count: ((Number(id) + i * 7) % 23) + own };
    });
  };
  const radarQuery = (q: (typeof radar.queries)[number], preview: boolean): EngineRadarQuery => {
    const { from, to } = radarRange();
    return { ...q, preview: preview ? radarDays(q.id, from, to) : [] };
  };

  const explore = fixture("ExplorePage", "explore-for-you")!;
  const exploreTabs = explore.exploreTabs!;
  const trendRows = (prefix: string, group: string | null): ReadonlyArray<EngineTrend> =>
    Array.from({ length: prefix === "Trending" ? 30 : 6 }, (_, i) => {
      const text = MORE_TEXT[i % MORE_TEXT.length]!;
      const words = text.split(" ").slice(0, 3).join(" ");
      const name = prefix === "Trending" ? `#${i + 1}: ${words}` : words;
      return {
        name,
        context: `${prefix} · ${(i + 1) * 1_200} posts`,
        url: `https://x.com/search?q=${encodeURIComponent(name)}`,
        images: [],
        group,
      };
    });

  const listsPage = fixture("ListsManagementPageTimeline", null)!;
  const xLists = new Map(listsPage.lists.map((l) => [l.listId, l]));
  const listHeader = (id: string): EngineBatch | null => {
    const own = fixture("ListByRestId", `list:${id}`);
    if (own !== undefined) return own;
    const l = xLists.get(id);
    return l === undefined
      ? null
      : page("ListByRestId", `list:${id}`, [], { top: null, lists: [{ ...l, group: null }] });
  };
  const listPeople = (id: string, offset: number) =>
    Array.from(
      { length: 5 },
      (_, i) => people[(Number(id.slice(-1)) + offset + i) % people.length]!,
    );
  /** The people the viewer follows who follow `id`: none for noor_lind and kofi_haddad. */
  const followersYouKnow = (id: string) =>
    id.endsWith("002") || id.endsWith("007") ? [] : listPeople(id, 3);
  /** X's REST friends/following/list.json for `id`: the first three of them, and how many. */
  const knownFollowers = (id: string) => {
    const known = followersYouKnow(id);
    return {
      users: known.slice(0, 3).map((u) => ({
        id_str: u.userId,
        screen_name: u.handle,
        name: u.name,
        profile_image_url_https: u.avatarUrl,
      })),
      next_cursor: 0,
      next_cursor_str: "0",
      previous_cursor: 0,
      previous_cursor_str: "0",
      total_count: known.length,
    };
  };

  // Every Community the fixtures describe, by X's card for it, with what the user's joins changed.
  const communityCards = new Map(
    fixtures
      .communities!.batches.filter((b) => b.op === "CommunitiesFetchOneQuery")
      .flatMap((b) => b.communities)
      .map((c) => [c.communityId, c]),
  );
  const communityChanges = new Map<string, Partial<EngineCommunity>>();
  const requested = new Set<string>();
  const community = (id: string): EngineCommunity | undefined => {
    const c = communityCards.get(id);
    return c === undefined ? undefined : { ...c, ...communityChanges.get(id) };
  };
  const changeCommunity = (
    id: string,
    change: (c: EngineCommunity) => Partial<EngineCommunity>,
  ) => {
    const c = community(id);
    if (c !== undefined) communityChanges.set(id, { ...communityChanges.get(id), ...change(c) });
  };

  // The NBA games the fixtures name, by id: a team's schedule, the day's scoreboard, one game.
  const games = new Map(batches.flatMap((b) => b.games ?? []).map((g) => [g.gameId, g]));

  const fixedTabs: ReadonlyArray<EngineHomeTab> = [
    { id: `tag:${PINNED_TAG}`, label: "Design" },
    { id: "list:600000000001", label: "Indie founders" },
  ];
  /** Communities the user pinned to Home, after X's other pinned tabs. */
  const pinnedCommunities = new Set<string>();
  const pinnedTabs = (): ReadonlyArray<EngineHomeTab> => [
    ...fixedTabs,
    ...[...pinnedCommunities].flatMap((id) => {
      const c = community(id);
      return c === undefined ? [] : [{ id: `community:${id}` as const, label: c.name }];
    }),
  ];

  /** X's cursor for its GIF search's second page, as read live. */
  const GIF_NEXT = "go50c50";

  // Bookmark folders, which X keeps to Premium: the fixtures' account has X's claim for them, and
  // a test can take it away. Each folder's posts newest first, with what X's dialogs did since.
  let premium =
    options.premium ?? fixture("GetUserClaims", null)?.claims?.includes(FOLDERS_CLAIM) === true;
  const listed = fixture("BookmarkFoldersSlice", null)?.bookmarkFolders;
  const folders: Array<EngineBookmarkFolder> = listed?.kind === "list" ? [...listed.folders] : [];
  const folderPosts = new Map(
    folders.map((f) => [
      f.folderId,
      [...(fixture("BookmarkFolderTimeline", f.folderId)?.order ?? [])],
    ]),
  );
  let madeFolders = 0;
  /** X lists a folder it just created, renamed or put a post in or took one out of first. */
  const toTop = (folder: EngineBookmarkFolder) =>
    folders.splice(
      0,
      folders.length,
      folder,
      ...folders.filter((f) => f.folderId !== folder.folderId),
    );

  /** The batch X answers `op` with, or null for a call no screen reads. */
  function batchFor(op: string, variables: Json): EngineBatch | null {
    const cursor = s(variables, "cursor");
    switch (op) {
      case "Viewer":
        return fixture("Viewer", null)!;
      case "PinnedTimelines":
        return page("PinnedTimelines", null, [], { top: null, homeTabs: pinnedTabs() });
      case "HomeTimeline":
      case "HomeLatestTimeline": {
        const tag = s(variables, "tag");
        if (tag !== undefined) return page(op, `tag:${tag}`, tag === PINNED_TAG ? pinnedTopic : []);
        const feed: Feed = op === "HomeTimeline" ? "forYou" : "following";
        const n = pageOf(feed === "forYou" ? forYou : following, cursor);
        const b = n === null ? null : n === 1 ? feedFirst(feed) : feedPage(feed, n);
        return b === null ? null : { ...b, cursor: cursor || null };
      }
      case "TweetDetail":
        return threadOf(s(variables, "focalTweetId") ?? "", s(variables, "rankingMode"));
      case "TweetResultByRestId": {
        // Only the fixtures' Articles have a reader page.
        const id = s(variables, "tweetId");
        const own = batches.find((b) => b.op === op && b.posts[0]?.postId === id);
        return own === undefined ? null : live(own);
      }
      case "UserByScreenName": {
        const u = byHandle(s(variables, "screen_name") ?? "");
        if (u === undefined) return null;
        return (
          (u.userId === people[0]!.userId ? live(fixture("UserByScreenName", u.handle)!) : null) ??
          page(op, u.handle, [], {
            top: null,
            // X says whether they offer Subscriptions: the creators X's Follow page lists do.
            users: [
              {
                ...liveUser(u),
                offersSubscriptions: fixture(
                  "ConnectTabTimeline",
                  "connect:creators",
                )!.people.includes(u.userId),
              },
            ],
          })
        );
      }
      case "SearchTimeline":
        return search(s(variables, "product") ?? "Top", s(variables, "rawQuery") ?? "");
      case "Bookmarks": {
        const b = fixture("Bookmarks", "bookmarks")!;
        const posts = bookmarks.flatMap((id) => {
          const p = b.posts.find((q) => q.postId === id) ?? basePosts.get(id);
          return p === undefined ? [] : [livePost({ ...p, bookmarked: true })];
        });
        return { ...live(b), posts, order: posts.map((p) => p.postId) };
      }
      case "NotificationsTimeline": {
        const own = fixture(op, s(variables, "timeline_type") ?? "All");
        return own === undefined ? page(op, s(variables, "timeline_type") ?? null, []) : live(own);
      }
      case "ExplorePage": {
        // For you, then the plain posts X pages in under it as it scrolls, and no more.
        const n = pageOf(explore, cursor);
        if (n === null) return null;
        return n === 1
          ? {
              ...live(explore),
              trends: explore.trends.filter((t) => !hiddenTrends.get("/explore")?.has(t.name)),
            }
          : n === 2
            ? {
                ...page(op, explore.key, morePages.forYou[1]!, { exploreTabs }),
                cursor: cursor || null,
                top: explore.top,
              }
            : null;
      }
      case "GenericTimelineById": {
        const id = s(variables, "timelineId") ?? "";
        const inspired = inspiration(id);
        if (inspired !== null) return inspired;
        const tab = exploreTabs.find((t) => t.timelineId === id);
        if (tab === undefined) return null;
        return page(op, id, [], {
          trends: trendRows(tab.label, tab.id === "news" ? "Today's News" : null).filter(
            (t) => !hiddenTrends.get(`/explore/tabs/${tab.id}`)?.has(t.name),
          ),
        });
      }
      case "ListsManagementPageTimeline":
        return live(listsPage);
      case "ListByRestId":
        return listHeader(s(variables, "listId") ?? "");
      case "ListLatestTweetsTimeline": {
        const id = s(variables, "listId") ?? "";
        const own = fixture(op, `list:${id}`);
        if (own !== undefined) return live(own);
        return xLists.has(id) ? page(op, `list:${id}`, morePages.forYou[0]!) : null;
      }
      case "ListMembers":
      case "ListSubscribers": {
        const id = s(variables, "listId") ?? "";
        if (!xLists.has(id)) return null;
        return ofPeople(op, `list:${id}`, listPeople(id, op === "ListMembers" ? 0 : 3));
      }
      // A profile's people pages, a different five people on each.
      case "BlueVerifiedFollowers":
      case "FollowersYouKnow":
      case "Followers":
      case "Following": {
        const id = s(variables, "userId") ?? "";
        if (user(id) === undefined) return null;
        const pages = ["Following", "Followers", "FollowersYouKnow", "BlueVerifiedFollowers"];
        return ofPeople(
          op,
          id,
          op === "FollowersYouKnow" ? followersYouKnow(id) : listPeople(id, pages.indexOf(op) + 1),
        );
      }
      case "Retweeters":
      case "Favoriters": {
        const id = s(variables, "tweetId") ?? "";
        if (post(id) === undefined) return null;
        return ofPeople(op, id, listPeople(id, op === "Retweeters" ? 1 : 4));
      }
      case "CarouselQuery":
        return live(fixture(op, "communities:mine")!);
      case "CommunitiesRankedTimeline":
      case "CommunitiesExploreTimeline":
        return live(fixture(op, null)!);
      case "CommunityQuery":
      case "CommunitiesFetchOneQuery": {
        const c = community(s(variables, "communityId") ?? "");
        return c === undefined
          ? null
          : page(op, `community:${c.communityId}`, [], { top: null, communities: [c] });
      }
      case "CommunityTweetsTimeline":
      case "CommunityMediaTimeline":
      case "CommunityAboutTimeline": {
        const id = s(variables, "communityId") ?? "";
        if (!communityCards.has(id)) return null;
        const mode = s(variables, "rankingMode");
        const k =
          op === "CommunityTweetsTimeline" && mode !== undefined && mode !== "Relevance"
            ? `community:${id}:${mode}`
            : `community:${id}`;
        const own = fixture(op, k);
        if (own !== undefined) return live(own);
        // The Communities the fixtures only name: a few posts, two moderators, no media.
        if (op === "CommunityAboutTimeline") {
          const box = (title: string, page: string, who: ReadonlyArray<EngineUser>) => ({
            title,
            userIds: who.map((u) => u.userId),
            link: `https://x.com/i/communities/${id}/${page}`,
          });
          return {
            ...ofPeople(op, k, people.slice(0, 5)),
            top: null,
            sections: [
              box("Moderators", "moderators", people.slice(0, 2)),
              box("Members", "members", people.slice(2, 5)),
            ],
          };
        }
        return page(op, k, op === "CommunityMediaTimeline" ? [] : morePages.forYou[0]!.slice(0, 3));
      }
      case "CommunityTweetSearchModuleQuery": {
        const id = s(variables, "communityId") ?? "";
        const query = s(variables, "query") ?? "";
        const mode = s(variables, "timelineRankingMode") ?? "Likes";
        const all = batchFor("CommunityTweetsTimeline", { communityId: id });
        if (all === null) return null;
        const words = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2);
        const found = all.order
          .flatMap((pid) => all.posts.find((p) => p.postId === pid) ?? [])
          .filter((p) => words.some((w) => p.text.toLowerCase().includes(w)))
          .toSorted((a, b) =>
            mode === "Recency"
              ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
              : b.metrics.likes - a.metrics.likes,
          );
        return page(op, `communitySearch:${id}:${mode}:${query}`, found);
      }
      // X asks every profile for a schedule; only a team's has one.
      case "UserSportsProfile":
        return fixture(op, s(variables, "rest_id") ?? "") ?? null;
      case "NBASchedule":
        return fixture(op, null) ?? null;
      case "NBAGameHydrate":
      case "NBALiveGame": {
        const g = games.get(s(variables, "rest_id") ?? "");
        return g === undefined ? null : page(op, g.gameId, [], { top: null, games: [g] });
      }
      case "SportsGameTopTimeline":
      case "SportsGameLatestTimeline": {
        const own = fixture(op, s(variables, "gameId") ?? "");
        return own === undefined ? null : live(own);
      }
      case "GifSearch": {
        // 50 a page, then a last page of 10, as X pages its GIF search; tiles named after the query.
        const query = s(variables, "query") ?? "";
        const from = cursor === undefined || cursor === "" ? 0 : cursor === GIF_NEXT ? 50 : null;
        if (from === null) return null;
        const gifs = Array.from({ length: from === 0 ? 50 : 10 }, (_, i): EngineGif => {
          const id = `m${from + i}${query.replace(/[^A-Za-z0-9]/g, "")}`;
          return {
            id: `giphy_${id}`,
            altText: `${query || "Trending"} ${from + i + 1} GIF`,
            // Never fetched from GIPHY: the mock's own path, holding the id as GIPHY's URLs do.
            url: `/media/${id}/200_d.gif`,
            stillUrl: `/media/${id}/200_d_s.gif`,
            width: 200,
            height: 150,
            provider: "GIPHY",
          };
        });
        return page(op, `gifs:${query}`, [], {
          top: null,
          cursor: cursor || null,
          bottom: from === 0 ? GIF_NEXT : null,
          gifs,
        });
      }
      // X's search of Communities, each tab its own operation; X finds nothing for a query the
      // fixtures hold no answer for.
      case "CommunitiesSearchQuery":
      case "GlobalCommunitiesPostSearchTimeline":
      case "GlobalCommunitiesLatestPostSearchTimeline": {
        const query = s(variables, op === "CommunitiesSearchQuery" ? "query" : "rawQuery") ?? "";
        const own = fixture(op, query);
        return query === ""
          ? null
          : own === undefined
            ? page(op, query, [], { top: null })
            : live(own);
      }
      case "ConnectTabTimeline": {
        const creators = (s(variables, "context") ?? "").includes("isCreatorOnlyConnectTab");
        return live(fixture(op, creators ? "connect:creators" : "connect:who")!);
      }
      // X's Post Analytics, for the user's own post the fixtures count.
      case "TweetActivityQuery":
        return fixture(op, s(variables, "restId") ?? "") ?? null;
      case "GetUserClaims":
        return page(op, null, [], {
          top: null,
          claims: premium ? [FOLDERS_CLAIM, ANALYTICS_CLAIM] : [],
        });
      // X asks for folders only for an account its claims give them.
      case "BookmarkFoldersSlice":
        return premium
          ? page(op, null, [], {
              top: null,
              bookmarkFolders: { kind: "list", folders: [...folders] },
            })
          : null;
      case "BookmarkFolderTimeline": {
        const id = s(variables, "bookmark_collection_id") ?? "";
        const ids = folderPosts.get(id);
        if (!premium || ids === undefined) return null;
        const own = fixture(op, id);
        const posts = ids.flatMap((pid) => {
          const p = own?.posts.find((q) => q.postId === pid) ?? basePosts.get(pid);
          return p === undefined ? [] : [livePost({ ...p, bookmarked: true })];
        });
        return { ...(own === undefined ? page(op, id, []) : live(own)), posts, order: ids };
      }
      // X's Radar, only for an account with Premium.
      case "insightsConfigQuery":
        return radar.premium ? page(op, null, [], { top: null, radarLimit: radar.limit }) : null;
      case "insightsListContextQuery":
        return radar.premium
          ? page(op, "radar", [], {
              top: null,
              radarQueries: radar.queries.map((q) =>
                radarQuery(q, variables.previewsEnabled === true),
              ),
            })
          : null;
      case "insightProviderGetQuery":
      case "usePostCountQuery": {
        const q = radar.queries.find((r) => r.id === s(variables, "id"));
        if (!radar.premium || q === undefined) return null;
        return op === "insightProviderGetQuery"
          ? page(op, q.id, [], { top: null, radarQueries: [radarQuery(q, false)] })
          : page(op, q.id, [], {
              top: null,
              radarCounts: radarDays(q.id, Number(variables.from_time), Number(variables.to_time)),
            });
      }
      case "postListQuery": {
        const [, query = ""] = /^(.+) -is:retweet since:/.exec(s(variables, "query") ?? "") ?? [];
        const product = s(variables, "product") ?? "Top";
        const hits = radarHits(query).toSorted((a, b) =>
          product === "Latest"
            ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
            : b.metrics.likes - a.metrics.likes,
        );
        return radar.premium && query !== ""
          ? page(op, `radar:${product}:${query}`, hits, { top: null })
          : null;
      }
      default:
        if (Object.hasOwn(ACCOUNT_ANALYTICS_KEYS, op))
          return premium ? (fixture(op, ACCOUNT_ANALYTICS_KEYS[op]!(variables)) ?? null) : null;
        if (
          /^User(Tweets|TweetsAndReplies|Media|HighlightsTweets|SuperFollowTweets|RepostsTimeline)$/.test(
            op,
          )
        ) {
          const u = user(s(variables, "userId") ?? "");
          return u === undefined ? null : profileTab(op, u);
        }
        return null;
    }
  }

  /** X's GraphQL answer to one request; writes go through `write`. */
  const respond = (op: string, variables: Json): Json => {
    const b = batchFor(op, variables);
    return b === null ? { data: {} } : encodeBody(b, liveUsers(), variables);
  };

  const changePost = (id: string, change: (p: EnginePost) => Partial<EnginePost>) => {
    const p = post(id);
    if (p !== undefined) postChanges.set(id, { ...postChanges.get(id), ...change(p) });
    return p !== undefined;
  };
  const changeUser = (id: string, change: (u: EngineUser) => Partial<EngineUser>) => {
    const u = user(id);
    if (u !== undefined) userChanges.set(id, { ...userChanges.get(id), ...change(u) });
    return u !== undefined;
  };
  const count = (p: EnginePost, metric: keyof EnginePost["metrics"], by: number) => ({
    metrics: { ...p.metrics, [metric]: Math.max(0, (p.metrics[metric] ?? 0) + by) },
  });

  /**
   * A write X's page sent (GraphQL or X's older REST calls): changes the state, logs it, and
   * answers as X does. Nothing leaves the mock.
   */
  function write(name: string, input: Json, path: string): Json {
    const id =
      s(input, "tweet_id") ??
      s(input, "source_tweet_id") ??
      s(input, "user_id") ??
      s(input, "id") ??
      s(input, "communityId") ??
      s(input, "bookmark_collection_id") ??
      null;
    presses.push({ kind: "write", name, target: id, path });
    const tweet = s(input, "tweet_id") ?? s(input, "source_tweet_id") ?? "";
    const done = (field: string) => ({ data: { [field]: "Done" } });
    switch (name) {
      case "FavoriteTweet":
        changePost(tweet, (p) => ({ liked: true, ...count(p, "likes", 1) }));
        return done("favorite_tweet");
      case "UnfavoriteTweet":
        changePost(tweet, (p) => ({ liked: false, ...count(p, "likes", -1) }));
        return done("unfavorite_tweet");
      case "CreateRetweet":
        changePost(tweet, (p) => ({ reposted: true, ...count(p, "reposts", 1) }));
        return {
          data: { create_retweet: { retweet_results: { result: { rest_id: `1${tweet}` } } } },
        };
      case "DeleteRetweet":
        changePost(tweet, (p) => ({ reposted: false, ...count(p, "reposts", -1) }));
        return { data: { unretweet: { source_tweet_results: { result: { rest_id: tweet } } } } };
      case "CreateBookmark":
        if (changePost(tweet, (p) => ({ bookmarked: true, ...count(p, "bookmarks", 1) })))
          bookmarks.splice(0, bookmarks.length, tweet, ...bookmarks.filter((b) => b !== tweet));
        return done("tweet_bookmark_put");
      case "DeleteBookmark":
        changePost(tweet, (p) => ({ bookmarked: false, ...count(p, "bookmarks", -1) }));
        bookmarks.splice(0, bookmarks.length, ...bookmarks.filter((b) => b !== tweet));
        return done("tweet_bookmark_delete");
      case "friendships/create":
        changeUser(id ?? "", (u) => ({ youFollow: true, followers: (u.followers ?? 0) + 1 }));
        return { id_str: id };
      case "friendships/destroy":
        changeUser(id ?? "", (u) => ({
          youFollow: false,
          followers: Math.max(0, (u.followers ?? 1) - 1),
        }));
        bell.delete(id ?? "");
        return { id_str: id };
      case "friendships/update":
        if (input.device === "true") bell.add(id ?? "");
        else if (input.device === "false") bell.delete(id ?? "");
        return { relationship: { source: { notifications_enabled: bell.has(id ?? "") } } };
      case "capi/vote": {
        const choice = Number(input.choice);
        changePost(tweet, (p) =>
          p.poll === null
            ? {}
            : {
                poll: {
                  ...p.poll,
                  voted: choice,
                  choices: p.poll.choices.map((c, i) =>
                    i + 1 === choice ? { ...c, votes: c.votes + 1 } : c,
                  ),
                },
              },
        );
        return { card: { voted: choice } };
      }
      // X's composer sends a post with bold or italic as a long post, its runs as richtext_tags.
      case "CreateNoteTweet":
      case "CreateTweet": {
        const text = s(input, "tweet_text") ?? "";
        const tags = (input.richtext_options as { richtext_tags?: ReadonlyArray<Json> } | undefined)
          ?.richtext_tags;
        const styles = (tags ?? []).flatMap((t) =>
          (t.richtext_types as ReadonlyArray<"Bold" | "Italic">).map((style) => ({
            start: t.from_index as number,
            end: t.to_index as number,
            style,
          })),
        );
        const created = make(0, {
          ...(styles.length === 0 ? {} : { styles }),
          text,
          createdAt: new Date().toISOString(),
          author: {
            userId: viewer.userId!,
            handle: viewer.handle,
            name: viewer.name ?? viewer.handle,
            followers: 0,
            verified: false,
          },
          avatarUrl: viewer.avatarUrl,
          metrics: { views: 0, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
        });
        const { __typename: _, ...result } = encodeTweet(created, liveUsers());
        return name === "CreateNoteTweet"
          ? { data: { notetweet_create: { tweet_results: { result } } } }
          : { data: { create_tweet: { tweet_results: { result } } } };
      }
      case "JoinCommunity":
        changeCommunity(id ?? "", (c) => ({ role: "Member", members: (c.members ?? 0) + 1 }));
        return {
          data: { community_join: { __typename: "Community", id_str: id, role: "Member" } },
        };
      case "RequestToJoinCommunity":
        requested.add(id ?? "");
        return { data: { community_join_request: "Done" } };
      // X's pin operations; synthetic: their variables are unconfirmed by a capture.
      case "PinTimeline":
        pinnedCommunities.add(id ?? "");
        return { data: { pin_timeline: "Done" } };
      case "UnpinTimeline":
        pinnedCommunities.delete(id ?? "");
        return { data: { unpin_timeline: "Done" } };
      case "LeaveCommunity":
        changeCommunity(id ?? "", (c) => ({
          role: "NonMember",
          members: Math.max(0, (c.members ?? 1) - 1),
        }));
        return { data: { community_leave: "Done" } };
      // X's folder dialogs and rows (bundle.BookmarkFolders), each answered as X does.
      case "createBookmarkFolder": {
        const folder = {
          folderId: String(800_000_000_101 + madeFolders++),
          name: s(input, "name") ?? "",
          imageUrl: null,
        };
        folderPosts.set(folder.folderId, []);
        toTop(folder);
        return { data: { bookmark_collection_create: encodeFolder(folder) } };
      }
      case "EditBookmarkFolder": {
        const known = folders.find((f) => f.folderId === s(input, "bookmark_collection_id"));
        if (known === undefined) return { data: {} };
        const folder = { ...known, name: s(input, "name") ?? known.name };
        toTop(folder);
        return { data: { bookmark_collection_update: encodeFolder(folder) } };
      }
      case "DeleteBookmarkFolder": {
        const folderId = s(input, "bookmark_collection_id") ?? "";
        folders.splice(0, folders.length, ...folders.filter((f) => f.folderId !== folderId));
        folderPosts.delete(folderId);
        return done("bookmark_collection_delete");
      }
      case "bookmarkTweetToFolder":
      case "RemoveTweetFromBookmarkFolder": {
        const folder = folders.find((f) => f.folderId === s(input, "bookmark_collection_id"));
        const ids = folderPosts.get(folder?.folderId ?? "");
        if (folder === undefined || ids === undefined) return { data: {} };
        const rest = ids.filter((pid) => pid !== tweet);
        folderPosts.set(
          folder.folderId,
          name === "bookmarkTweetToFolder" ? [tweet, ...rest] : rest,
        );
        toTop(folder);
        return done(
          name === "bookmarkTweetToFolder"
            ? "bookmark_collection_tweet_put"
            : "bookmark_collection_tweet_delete",
        );
      }
      // X's Radar: a query made from X's form, and one deleted from X's list.
      case "createInsightInputMutation": {
        const made = String(radar.next++);
        radar.queries.unshift({
          id: made,
          title: s(input, "title") ?? "",
          query: s(input, "advanced_query") ?? "",
          createdAt: new Date().toISOString(),
        });
        return {
          data: {
            create_insight_rule_v2: {
              __typename: "InsightRuleMutationSuccess",
              result: { rest_id: made, id: btoa(`InsightRule:${made}`) },
            },
          },
        };
      }
      case "deleteInsightButtonMutation": {
        const at = radar.queries.findIndex((q) => q.id === id);
        if (at !== -1) radar.queries.splice(at, 1);
        return {
          data: {
            delete_insight_rule_v2:
              at === -1
                ? { __typename: "InsightRuleFailure", error_code: 404, error_message: "Not found" }
                : {
                    __typename: "InsightRuleMutationSuccess",
                    result: { rest_id: id, id: btoa(`InsightRule:${id}`) },
                  },
          },
        };
      }
      default:
        // Mutes, blocks and the rest are only logged: no screen reads them back.
        return { data: {} };
    }
  }

  return {
    viewer,
    viewerUser,
    /** Whether X's composer lets the account bold and italicize (`MockOptions.formatting`). */
    formats: options.formatting === true,
    people,
    /** Home's pinned tabs as X's PinnedTimelines lists them now. */
    get pinnedTabs() {
      return pinnedTabs();
    },
    exploreTabs,
    xLists,
    batchFor,
    respond,
    knownFollowers,
    write,
    post,
    user,
    byHandle,
    /** Whether post notifications are on for someone the user follows (X's bell). */
    bellOn: (userId: string) => bell.has(userId),
    /** Whether X offers a subscription to this person: the creators its Follow page lists. */
    isCreator: (userId: string) =>
      fixture("ConnectTabTimeline", "connect:creators")!.people.includes(userId),
    /** Everything pressed and written, in order. */
    presses,
    /** X's Radar: whether the account has Premium, X's query limit, and its queries. */
    radar,
    setTrendHidden: (path: string, name: string, hidden: boolean) => {
      const names = hiddenTrends.get(path) ?? new Set<string>();
      if (hidden) names.add(name);
      else names.delete(name);
      hiddenTrends.set(path, names);
    },
    /** New posts at the top of a Home feed's first page, as X has them on its next load. */
    arrive: (feed: Feed, n: number): ReadonlyArray<EnginePost> => {
      const top = feedFirst(feed).posts[0]!;
      const fresh = Array.from({ length: n }, (_, i) =>
        make(0, {
          createdAt: new Date(Date.parse(top.createdAt) + (n - i) * 60_000).toISOString(),
        }),
      );
      arrived[feed].unshift(...fresh);
      return fresh;
    },
    /** The posts a feed's first page lists, in X's order. */
    feed: (feed: Feed) => {
      const b = feedFirst(feed);
      return b.order.filter((id) => b.posts.some((p) => p.postId === id));
    },
    /** A feed's first page's Who to follow, and the post X put it after. */
    whoToFollow: (feed: Feed) => {
      const b = feedFirst(feed);
      const module = b.modules[0];
      return module === undefined
        ? undefined
        : { module, after: b.order[b.order.indexOf(module.id) - 1] };
    },
    /** Post ids of Explore For you's second page, which X pages in as it scrolls. */
    exploreNextIds: () => batchFor("ExplorePage", { cursor: explore.bottom })!.order,
    /** Post ids of a feed page after the first. */
    feedPageIds: (feed: Feed, n: number) => feedPage(feed, n).order,
    fixture,
    /** Whether X's page sends its claims at boot; some accounts' never do. */
    sendsClaims: options.sendsClaims ?? true,
    fixtures: () => fixtures,
    lists: (): ReadonlyArray<EngineList> => [...xLists.values()],
    community,
    /** An NBA game the fixtures name. */
    game: (id: string) => games.get(id),
    /** Whether the user pinned a Community to Home (X's Pin in its header). */
    communityPinned: (id: string) => pinnedCommunities.has(id),
    /** Whether X's claims give the account bookmark folders (Premium). */
    get premium() {
      return premium;
    },
    setPremium: (on: boolean) => {
      premium = on;
    },
    /** The account's bookmark folders in X's order, and each one's posts, newest first. */
    folders: (): ReadonlyArray<EngineBookmarkFolder> => [...folders],
    folderPosts: (folderId: string): ReadonlyArray<string> => folderPosts.get(folderId) ?? [],
    /** Whether the user asked to join a Community that asks first, and waits for its moderators. */
    communityRequested: (id: string) => requested.has(id),
    /** The Communities a hub tab's posts are from, in X's order: X fetches a card for each. */
    hubCommunities: (op: "CommunitiesRankedTimeline" | "CommunitiesExploreTimeline") => [
      ...new Set(
        fixture(op, null)!.posts.flatMap((p) =>
          [...communityCards.values()].flatMap((c) =>
            c.name === p.context?.text ? [c.communityId] : [],
          ),
        ),
      ),
    ],
  };
}

export type MockState = ReturnType<typeof createMockState>;

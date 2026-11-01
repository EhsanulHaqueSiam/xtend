import type {
  EngineBatch,
  EngineCommunity,
  EngineList,
  EnginePost,
  EngineTrend,
  EngineUser,
} from "@xtend/contracts";

import { synth } from "../../../web/src/components/xnative/engineFixtures.ts";
import { encodeBody, encodeTweet } from "./graphql.ts";

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

const FEEDS = ["forYou", "following"] as const;
export type Feed = (typeof FEEDS)[number];
/** How many pages each Home feed has before X runs out; the rest of the mock's lists have one. */
const FEED_PAGES: Readonly<Record<Feed, number>> = { forYou: 3, following: 2 };
const PAGE_SIZE = 6;
const PINNED_TAG = "1540000000000000001";

const key = (op: string, k: string | null) => `${op}|${k ?? ""}`;
const s = (variables: Json, name: string) =>
  typeof variables[name] === "string" ? (variables[name] as string) : undefined;

/** One mock X: its state, and the answers and pages read from it. */
export function createMockState() {
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
  const people = [...baseUsers.values()];
  const forYou = fixture("HomeTimeline", null)!;
  const following = fixture("HomeLatestTimeline", null)!;

  // Made-up posts past the fixtures' first pages, by the same people.
  let made = 0;
  const make = (minutesAgo: number, extra: Partial<EnginePost> = {}): EnginePost => {
    const n = made++;
    const base = forYou.posts[n % forYou.posts.length]!;
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
      media: [],
      hasMedia: false,
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
    forYou: Array.from({ length: FEED_PAGES.forYou - 1 }, (_, page) =>
      Array.from({ length: PAGE_SIZE }, (_, i) => make(400 + page * 600 + i * 40)),
    ),
    following: Array.from({ length: FEED_PAGES.following - 1 }, (_, page) =>
      Array.from({ length: PAGE_SIZE }, (_, i) => make(500 + page * 600 + i * 45)),
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
  const bookmarks = fixture("Bookmarks", null)!.posts.map((p) => p.postId);
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
      bottom: n < FEED_PAGES[feed] ? `${first.bottom}#p${n + 1}` : null,
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

  const explore = fixture("ExplorePage", "explore-for-you")!;
  const exploreTabs = explore.exploreTabs!;
  const trendRows = (prefix: string, group: string | null): ReadonlyArray<EngineTrend> =>
    MORE_TEXT.slice(0, 6).map((text, i) => {
      const name = text.split(" ").slice(0, 3).join(" ");
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

  const pinnedTabs = [
    { id: `tag:${PINNED_TAG}` as const, label: "Design" },
    { id: "list:600000000001" as const, label: "Indie founders" },
  ];

  /** The batch X answers `op` with, or null for a call no screen reads. */
  function batchFor(op: string, variables: Json): EngineBatch | null {
    const cursor = s(variables, "cursor");
    switch (op) {
      case "Viewer":
        return fixture("Viewer", null)!;
      case "PinnedTimelines":
        return page("PinnedTimelines", null, [], { top: null, homeTabs: pinnedTabs });
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
      case "UserByScreenName": {
        const u = byHandle(s(variables, "screen_name") ?? "");
        if (u === undefined) return null;
        return (
          (u.userId === people[0]!.userId ? live(fixture("UserByScreenName", u.handle)!) : null) ??
          page(op, u.handle, [], { top: null, users: [liveUser(u)] })
        );
      }
      case "SearchTimeline":
        return search(s(variables, "product") ?? "Top", s(variables, "rawQuery") ?? "");
      case "Bookmarks": {
        const b = fixture("Bookmarks", null)!;
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
      case "ExplorePage":
        return {
          ...live(explore),
          trends: explore.trends.filter((t) => !hiddenTrends.get("/explore")?.has(t.name)),
        };
      case "GenericTimelineById": {
        const id = s(variables, "timelineId") ?? "";
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
      case "ConnectTabTimeline": {
        const creators = (s(variables, "context") ?? "").includes("isCreatorOnlyConnectTab");
        return live(fixture(op, creators ? "connect:creators" : "connect:who")!);
      }
      default:
        if (/^User(Tweets|TweetsAndReplies|Media|HighlightsTweets|SuperFollowTweets)$/.test(op)) {
          const u = user(s(variables, "userId") ?? "");
          return u === undefined ? null : profileTab(op, u);
        }
        return null;
    }
  }

  /** X's GraphQL answer to one request; writes go through `write`. */
  const respond = (op: string, variables: Json): Json => {
    const b = batchFor(op, variables);
    return b === null ? { data: {} } : encodeBody(b, liveUsers());
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
      case "CreateTweet": {
        const text = s(input, "tweet_text") ?? "";
        const created = make(0, {
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
        return { data: { create_tweet: { tweet_results: { result } } } };
      }
      case "JoinCommunity":
        changeCommunity(id ?? "", (c) => ({ role: "Member", members: (c.members ?? 0) + 1 }));
        return {
          data: { community_join: { __typename: "Community", id_str: id, role: "Member" } },
        };
      case "RequestToJoinCommunity":
        requested.add(id ?? "");
        return { data: { community_join_request: "Done" } };
      case "LeaveCommunity":
        changeCommunity(id ?? "", (c) => ({
          role: "NonMember",
          members: Math.max(0, (c.members ?? 1) - 1),
        }));
        return { data: { community_leave: "Done" } };
      default:
        // Mutes, blocks and the rest are only logged: no screen reads them back.
        return { data: {} };
    }
  }

  return {
    viewer,
    viewerUser,
    people,
    pinnedTabs,
    exploreTabs,
    xLists,
    batchFor,
    respond,
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
    /** Post ids of a feed page after the first. */
    feedPageIds: (feed: Feed, n: number) => feedPage(feed, n).order,
    fixture,
    fixtures: () => fixtures,
    lists: (): ReadonlyArray<EngineList> => [...xLists.values()],
    community,
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

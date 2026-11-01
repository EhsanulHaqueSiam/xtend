import type {
  EngineBatch,
  EngineCommunity,
  EngineExploreTab,
  EngineHomeTab,
  EngineList,
  EngineModule,
  EngineNotification,
  EnginePeopleSection,
  EnginePost,
  EngineTrend,
  EngineUser,
  EngineViewer,
  XPost,
} from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";

/**
 * What the X engine (the off-screen x.com webview) has shown, for Xtend's own X screens: every
 * post and person by id, and per surface what X listed there in X's order. Fed by the desktop's
 * capture, one GraphQL response at a time; nothing here calls X.
 */

/**
 * Pages with one list per account. "search", "post" and the "profile" ones also mirror the last
 * search, post or profile the engine fetched, for screens that reset them before each visit;
 * screens that move the engine with `xGo` read the keyed surfaces below instead.
 */
export type Surface =
  | "forYou"
  | "following"
  | "search"
  | "post"
  | "bookmarks"
  | "likes"
  | "profile"
  | "profile:replies"
  | "profile:media"
  | "profile:reposts"
  | "profile:articles"
  | "profile:highlights"
  | "profile:subs"
  | "notifications"
  | "notifications:mentions"
  | "notifications:verified"
  | "lists"
  | CommunitiesTab;
/**
 * X's Communities hub: Home (posts from the user's Communities), Explore, and "mine", the user's
 * Communities as X's carousel lists them.
 */
export type CommunitiesTab = "communities:home" | "communities:explore" | "communities:mine";

/** @public A profile's tabs, as X names its pages (`/<handle>/with_replies` is "replies"). */
export type ProfileTab =
  | "posts"
  | "replies"
  | "media"
  | "reposts"
  | "articles"
  | "highlights"
  | "subs";
/** @public X's search tabs, by the product name X's request carries. */
export type SearchProduct = "Top" | "Latest" | "People" | "Media";

/**
 * Pages keyed by what they show, so a page X serves again from its own cache (no fetch) still has
 * its posts: a pinned Home tab, a List, a Community, an Explore tab, one search, one post's
 * thread, one profile tab.
 */
type KeyedSurface =
  | EngineHomeTab["id"]
  | `explore:${string}`
  | `search:${SearchProduct}:${string}`
  | `post:${string}`
  | `reposters:${string}`
  | `likers:${string}`
  | `listMembers:${string}`
  | `listFollowers:${string}`
  | ConnectTab
  | `communityMedia:${string}`
  | `communityAbout:${string}`
  | `profile:${ProfileTab}:${string}`;
/** X's Follow page's tabs (Who to follow, Creators for you), as the capture keys them. */
export type ConnectTab = "connect:who" | "connect:creators";
export type AnySurface = Surface | KeyedSurface;

/** @public The keyed surfaces screens read, named the way the capture keys them. */
export const searchSurface = (product: SearchProduct, query: string) =>
  `search:${product}:${query}` as const;
/** X's reply orders for a thread, as TweetDetail's `rankingMode` names them; Relevance is X's default. */
export const REPLY_SORTS = ["Relevance", "Recency", "Likes"] as const;
export type ReplySort = (typeof REPLY_SORTS)[number];
/** @public A thread's list per reply order: X sends each order's replies afresh, in its own order. */
export const postSurface = (postId: string, sort: ReplySort = "Relevance") =>
  sort === "Relevance" ? (`post:${postId}` as const) : (`post:${postId}:${sort}` as const);
/** @public Who reposted and who liked a post, as X's Post activity lists them. */
export const postPeopleSurface = (kind: "reposters" | "likers", postId: string) =>
  `${kind}:${postId}` as const;
/** @public A List's members and followers, as X's List members and followers pages list them. */
export const listPeopleSurface = (kind: "listMembers" | "listFollowers", listId: string) =>
  `${kind}:${listId}` as const;
/**
 * The search X's Post activity runs for a post's quotes, as its Quotes tab sends it; the results
 * sit under that search's own surface.
 */
export const quotesQuery = (postId: string) =>
  `quoted_tweet_id:${postId} OR url:"status/${postId}/video" OR url:"status/${postId}/photo"`;
/** A Community's tabs, as X names them. */
export type CommunityTab = "Top" | "Latest" | "Media" | "About";
/**
 * Where a Community's tab lands: Top shares `community:<id>` with Home's pinned tab, Latest is its
 * posts by Recency, About lists its moderators.
 */
export const communitySurface = (id: string, tab: CommunityTab) =>
  tab === "Top"
    ? (`community:${id}` as const)
    : tab === "Latest"
      ? (`community:${id}:Recency` as const)
      : tab === "Media"
        ? (`communityMedia:${id}` as const)
        : (`communityAbout:${id}` as const);
/** @public */
export const profileSurface = (tab: ProfileTab, userId: string) =>
  `profile:${tab}:${userId}` as const;

const PROFILE_OPS: Readonly<Record<string, ProfileTab>> = {
  // X has used each pair of names for a profile's tabs.
  UserTweets: "posts",
  UserOriginalsTimeline: "posts",
  UserTweetsAndReplies: "replies",
  UserRepliesTimeline: "replies",
  UserMedia: "media",
  UserVideoTimeline: "media",
  UserRepostsTimeline: "reposts",
  UserArticlesTweets: "articles",
  UserHighlightsTweets: "highlights",
  UserSuperFollowTweets: "subs",
};

const COMMUNITIES_OPS: Readonly<Record<string, CommunitiesTab>> = {
  CommunitiesRankedTimeline: "communities:home",
  CommunitiesExploreTimeline: "communities:explore",
  CarouselQuery: "communities:mine",
};

const SEARCH_PRODUCTS: ReadonlyArray<string> = [
  "Top",
  "Latest",
  "People",
  "Media",
] satisfies ReadonlyArray<SearchProduct>;
const isProduct = (p: string): p is SearchProduct => SEARCH_PRODUCTS.includes(p);

/** The capture's key for a Home tab, a Community or a List, typed as the surface it names. */
const tabKey = <P extends "tag" | "community" | "list">(key: string | null, prefix: P) =>
  key?.startsWith(`${prefix}:`) === true ? (key as `${P}:${string}`) : undefined;

/**
 * Which surfaces a response feeds, its own first; none for the many X calls no screen lists.
 */
export function surfacesOf(batch: Pick<EngineBatch, "op" | "key">): ReadonlyArray<AnySurface> {
  const { op, key } = batch;
  const tab = PROFILE_OPS[op];
  if (tab !== undefined) {
    const legacy = tab === "posts" ? "profile" : (`profile:${tab}` as const);
    return key === null ? [legacy] : [profileSurface(tab, key), legacy];
  }
  if (op === "SearchTimeline") {
    const product = key?.slice(0, key.indexOf(":")) ?? "";
    return isProduct(product) && key !== null
      ? [searchSurface(product, key.slice(product.length + 1)), "search"]
      : ["search"];
  }
  // The capture keys a sorted thread `<id>:<rankingMode>`, which is that sort's own surface.
  if (op === "TweetDetail") return key === null ? ["post"] : [`post:${key}`, "post"];
  if (op === "HomeTimeline") return [tabKey(key, "tag") ?? "forYou"];
  if (op === "HomeLatestTimeline") return ["following"];
  if (op === "Bookmarks") return ["bookmarks"];
  if (key !== null && op === "Retweeters") return [postPeopleSurface("reposters", key)];
  if (key !== null && op === "Favoriters") return [postPeopleSurface("likers", key)];
  // The signed-in account's likes, under X's History beside Bookmarks.
  if (op === "Likes") return ["likes"];
  if (op === "ListsManagementPageTimeline") return ["lists"];
  const hub = COMMUNITIES_OPS[op];
  if (hub !== undefined) return [hub];
  // The capture keys every Community call `community:<id>`, its Latest `community:<id>:Recency`.
  const communityId = tabKey(key, "community")?.slice("community:".length);
  if (communityId !== undefined && op === "CommunityMediaTimeline")
    return [communitySurface(communityId, "Media")];
  if (communityId !== undefined && op === "CommunityAboutTimeline")
    return [communitySurface(communityId, "About")];
  if (op === "ConnectTabTimeline" && (key === "connect:who" || key === "connect:creators"))
    return [key];
  // The capture keys every List call `list:<id>`.
  const listId = tabKey(key, "list")?.slice("list:".length);
  if (listId !== undefined && op === "ListMembers")
    return [listPeopleSurface("listMembers", listId)];
  if (listId !== undefined && op === "ListSubscribers")
    return [listPeopleSurface("listFollowers", listId)];
  const keyed =
    op === "CommunityTweetsTimeline"
      ? tabKey(key, "community")
      : op === "ListLatestTweetsTimeline"
        ? tabKey(key, "list")
        : (op === "ExplorePage" || op === "GenericTimelineById") && key !== null
          ? (`explore:${key}` as const)
          : undefined;
  if (keyed !== undefined) return [keyed];
  if (op === "NotificationsTimeline")
    return [
      key === "Mentions"
        ? "notifications:mentions"
        : key === "Verified"
          ? "notifications:verified"
          : "notifications",
    ];
  return [];
}

type PerSurface<A> = Readonly<Record<Surface, ReadonlyArray<A>>> &
  Readonly<Partial<Record<KeyedSurface, ReadonlyArray<A>>>>;

// Empty arrays fit every element type, so one value serves every per-surface field.
const NONE: PerSurface<never> = {
  forYou: [],
  following: [],
  search: [],
  post: [],
  bookmarks: [],
  likes: [],
  profile: [],
  "profile:replies": [],
  "profile:media": [],
  "profile:reposts": [],
  "profile:articles": [],
  "profile:highlights": [],
  "profile:subs": [],
  notifications: [],
  "notifications:mentions": [],
  "notifications:verified": [],
  lists: [],
  "communities:home": [],
  "communities:explore": [],
  "communities:mine": [],
};

/** What a post is on one page only: the line above it there, and its place in a thread there. */
type PostEntry = Pick<EnginePost, "context" | "conversation">;

export interface EngineState {
  /** Every post by id, as last sent; read a list's posts with `postOn`. */
  readonly posts: ReadonlyMap<string, EnginePost>;
  /**
   * Per surface, each listed post's own context and thread place: a repost on Home keeps
   * "Theo reposted" after its thread page sent the same post without it.
   */
  readonly entries: Readonly<Partial<Record<AnySurface, ReadonlyMap<string, PostEntry>>>>;
  /** Everyone the engine has seen (authors, people X listed, profile headers), by user id. */
  readonly users: ReadonlyMap<string, EngineUser>;
  /**
   * Follows and unfollows X took for the user's click, per person, until a capture of that person
   * agrees: a page X answered before the click would otherwise turn the button back.
   */
  readonly asked: ReadonlyMap<string, boolean>;
  /**
   * The role X took for the user's join, ask or leave, per Community, until a capture of it agrees:
   * X's page shows its own state from its cache and fetches nothing to say so.
   */
  readonly membership: ReadonlyMap<string, CommunityRole>;
  /** X's people modules (Who to follow) by id; a list names one where X put it among the posts. */
  readonly modules: ReadonlyMap<string, EngineModule>;
  /** Post and module ids per surface, in X's order. */
  readonly lists: PerSurface<string>;
  /** Newer posts X fetched for a list's top; they wait behind a pill instead of shifting the list. */
  readonly waiting: PerSurface<string>;
  /**
   * X's own order for the list's top once the waiting posts show: the newer page as X sent it,
   * posts already listed included, so the list matches X's page again and X's buttons are at hand.
   */
  readonly nextTop: PerSurface<string>;
  /** User ids per surface. */
  readonly people: PerSurface<string>;
  /** X's titled boxes of people per surface (a Community's Moderators and Members). */
  readonly sections: PerSurface<EnginePeopleSection>;
  readonly trends: PerSurface<EngineTrend>;
  readonly notifications: PerSurface<EngineNotification>;
  /** X Lists by id: the Lists page's rows and each List's own header. */
  readonly xLists: ReadonlyMap<string, EngineList>;
  /** List ids per surface, in X's order (the Lists page's sections follow it). */
  readonly listIds: PerSurface<string>;
  /** Communities by id, each the sum of what X's responses said of it (see `EngineCommunity`). */
  readonly communities: ReadonlyMap<string, EngineCommunity>;
  /** Community ids per surface, in X's order (the user's Communities). */
  readonly communityIds: PerSurface<string>;
  /** Home's pinned tabs after For you and Following, as X named them. */
  readonly homeTabs: ReadonlyArray<EngineHomeTab>;
  readonly exploreTabs: ReadonlyArray<EngineExploreTab>;
  /** The signed-in account (the composer's avatar), once X's page has loaded. */
  readonly viewer: EngineViewer | null;
  /** The page cursors X last answered per surface, to tell a fetch of newer posts from the next page. */
  readonly cursors: Readonly<
    Partial<Record<AnySurface, { readonly top: string | null; readonly bottom: string | null }>>
  >;
}

export const emptyEngine: EngineState = {
  posts: new Map(),
  entries: {},
  users: new Map(),
  asked: new Map(),
  membership: new Map(),
  modules: new Map(),
  lists: NONE,
  waiting: NONE,
  nextTop: NONE,
  people: NONE,
  sections: NONE,
  trends: NONE,
  notifications: NONE,
  xLists: new Map(),
  listIds: NONE,
  communities: new Map(),
  communityIds: NONE,
  homeTabs: [],
  exploreTabs: [],
  viewer: null,
  cursors: {},
};

/** A surface's entries; a tab X has not sent yet has none. */
export const at = <A>(per: PerSurface<A>, surface: AnySurface): ReadonlyArray<A> =>
  (per as Partial<Record<AnySurface, ReadonlyArray<A>>>)[surface] ?? [];

const set = <A>(
  per: PerSurface<A>,
  surface: AnySurface,
  value: ReadonlyArray<A>,
): PerSurface<A> => ({
  ...per,
  [surface]: value,
});

/** Joins `fresh` after or before `list`, skipping what it already holds. */
function join<A>(
  list: ReadonlyArray<A>,
  fresh: ReadonlyArray<A>,
  id: (a: A) => string,
  first = false,
) {
  const known = new Set(list.map(id));
  const added = fresh.filter((a) => !known.has(id(a)));
  return first ? [...added, ...list] : [...list, ...added];
}

/**
 * Folds one response into the store. Posts that appear only as a quote inside another stay out
 * of the list. A fetch of newer posts waits behind the pill: X asked with the list's top cursor,
 * or reloaded the page's first page while the list already shows posts, or (when the cursor is one
 * this store never saw) every new post is newer than the list's top.
 */
export function mergeBatch(state: EngineState, batch: EngineBatch): EngineState {
  const posts = new Map(state.posts);
  for (const post of batch.posts) posts.set(post.postId, post);
  let users = state.users;
  let asked = state.asked;
  if (batch.users.length > 0) {
    const next = new Map(users);
    for (const user of batch.users) next.set(user.userId, user);
    users = next;
    const agreed = batch.users.filter((u) => asked.get(u.userId) === u.youFollow);
    if (agreed.length > 0) {
      const left = new Map(asked);
      for (const u of agreed) left.delete(u.userId);
      asked = left;
    }
  }
  let xLists = state.xLists;
  if (batch.lists.length > 0) {
    const next = new Map(xLists);
    for (const list of batch.lists) next.set(list.listId, list);
    xLists = next;
  }
  let communities = state.communities;
  if (batch.communities.length > 0) {
    const next = new Map(communities);
    for (const c of batch.communities) {
      const known = next.get(c.communityId);
      // A field this response left out (null) keeps what an earlier one said.
      next.set(
        c.communityId,
        known === undefined
          ? c
          : {
              ...c,
              description: c.description ?? known.description,
              bannerUrl: c.bannerUrl ?? known.bannerUrl,
              members: c.members ?? known.members,
              topic: c.topic ?? known.topic,
              rules: c.rules ?? known.rules,
              joinPolicy: c.joinPolicy ?? known.joinPolicy,
              role: c.role ?? known.role,
            },
      );
    }
    communities = next;
  }
  // X agrees once it sends the role taken; a request stands until X makes them a member.
  const agreed = batch.communities.filter((c) => {
    const taken = state.membership.get(c.communityId);
    return (
      taken !== undefined &&
      (c.role === taken || (taken === "Requested" && c.role !== null && c.role !== "NonMember"))
    );
  });
  const membership =
    agreed.length === 0
      ? state.membership
      : new Map([...state.membership].filter(([id]) => !agreed.some((c) => c.communityId === id)));
  const merged: EngineState = {
    ...state,
    posts,
    modules:
      batch.modules.length === 0
        ? state.modules
        : new Map([...state.modules, ...batch.modules.map((m) => [m.id, m] as const)]),
    users,
    asked,
    membership,
    xLists,
    communities,
    homeTabs: batch.homeTabs ?? state.homeTabs,
    exploreTabs: batch.exploreTabs ?? state.exploreTabs,
    // X's nav names no user id; keep the one X's Viewer call gave for the same account.
    viewer:
      batch.viewer === null
        ? state.viewer
        : {
            ...batch.viewer,
            userId:
              batch.viewer.userId ??
              (state.viewer?.handle === batch.viewer.handle ? state.viewer.userId : null),
          },
  };
  const listed = surfacesOf(batch).reduce(
    (state, surface) => mergeInto(state, batch, surface),
    merged,
  );
  if (!/^Create(Note)?Tweet$/.test(batch.op)) return listed;
  // The response also carries the post it quotes, which stays where it was.
  const created = batch.posts.filter((p) => !batch.posts.some((q) => q.quotedId === p.postId));
  return created.reduce(placeCreated, listed);
}

/**
 * The user's own new post, from X's composer response, where X shows it at once: a reply right
 * under the post it answers, whose reply count goes up by one; any other post on top of Home and
 * the user's profile. X's next page of those lists already holds it, so it never shows twice.
 */
function placeCreated(state: EngineState, post: EnginePost): EngineState {
  const parentId = post.replyToId;
  if (parentId === null) {
    const surfaces: ReadonlyArray<AnySurface> = [
      "forYou",
      "following",
      profileSurface("posts", post.author.userId),
    ];
    return {
      ...state,
      lists: surfaces.reduce(
        (lists, s) => set(lists, s, unique([post.postId, ...at(lists, s)])),
        state.lists,
      ),
    };
  }
  const parent = state.posts.get(parentId);
  const posts =
    parent === undefined
      ? state.posts
      : new Map(state.posts).set(parentId, {
          ...parent,
          metrics: { ...parent.metrics, replies: parent.metrics.replies + 1 },
        });
  return {
    ...state,
    posts,
    // X shows it under the post whatever the reply order. A thread never opened here has nothing
    // to join; X's page brings the reply when it opens.
    lists: REPLY_SORTS.reduce((lists, sort) => {
      const surface = postSurface(parentId, sort);
      const list = at(lists, surface).filter((id) => id !== post.postId);
      const under = list.indexOf(parentId) + 1;
      return under === 0
        ? lists
        : set(lists, surface, [...list.slice(0, under), post.postId, ...list.slice(under)]);
    }, state.lists),
  };
}

/** One response into one surface's lists, by which page of it X fetched. */
function mergeInto(state: EngineState, batch: EngineBatch, surface: AnySurface): EngineState {
  const posts = state.posts;

  const seen = state.cursors[surface];
  const page =
    batch.cursor === null
      ? "first"
      : batch.cursor === seen?.top
        ? "top"
        : batch.cursor === seen?.bottom
          ? "bottom"
          : "unknown";
  const cursors = {
    ...state.cursors,
    [surface]: {
      top: page === "bottom" ? (seen?.top ?? null) : (batch.top ?? seen?.top ?? null),
      bottom: page === "top" ? (seen?.bottom ?? null) : (batch.bottom ?? seen?.bottom ?? null),
    },
  };

  const list = at(state.lists, surface);
  // X's own entry order; failing that, every post but the ones only quoted inside another.
  const quoted = new Set(batch.posts.flatMap((p) => (p.quotedId === null ? [] : [p.quotedId])));
  const sent = new Set([...batch.posts.map((p) => p.postId), ...batch.modules.map((m) => m.id)]);
  const known = new Set([...list, ...at(state.waiting, surface)]);
  const order =
    batch.order.length > 0
      ? batch.order.filter((id) => sent.has(id))
      : batch.posts.map((p) => p.postId).filter((id) => !quoted.has(id));
  const fresh = order.filter((id) => !known.has(id));
  const freshPosts = fresh.filter((id) => posts.has(id));
  const top = list.map((id) => posts.get(id)).find((p) => p !== undefined);
  const again = top !== undefined && (page === "top" || page === "first");
  const waitingNow = new Set(at(state.waiting, surface));
  const newer =
    // A thread's newer replies join it at once, as X shows them.
    surface !== "post" &&
    !surface.startsWith("post:") &&
    top !== undefined &&
    ((freshPosts.length > 0 &&
      (again ||
        (page === "unknown" &&
          freshPosts.every((id) => posts.get(id)!.createdAt > top.createdAt)))) ||
      // X's top again around posts still behind the pill: a module it adds waits with them.
      (again && fresh.length > 0 && order.some((id) => waitingNow.has(id))));

  // People, trends and notifications: a first page replaces, a newer page goes on top.
  const userIds = batch.people;
  const people =
    userIds.length === 0
      ? state.people
      : set(
          state.people,
          surface,
          page === "first" ? userIds : join(at(state.people, surface), userIds, String),
        );
  const trends =
    batch.trends.length === 0
      ? state.trends
      : set(
          state.trends,
          surface,
          page === "first" ? batch.trends : [...at(state.trends, surface), ...batch.trends],
        );
  const listIdsNow = batch.lists.map((l) => l.listId);
  const listIds =
    listIdsNow.length === 0
      ? state.listIds
      : set(
          state.listIds,
          surface,
          page === "first" ? listIdsNow : join(at(state.listIds, surface), listIdsNow, String),
        );
  const communityIdsNow = batch.communities.map((c) => c.communityId);
  // The user's Communities replace the list on X's first page, even with none left.
  const communityIds =
    communityIdsNow.length === 0 && !(surface === "communities:mine" && page === "first")
      ? state.communityIds
      : set(
          state.communityIds,
          surface,
          page === "first"
            ? communityIdsNow
            : join(at(state.communityIds, surface), communityIdsNow, String),
        );
  const sections =
    batch.sections.length === 0
      ? state.sections
      : set(
          state.sections,
          surface,
          page === "first" ? batch.sections : [...at(state.sections, surface), ...batch.sections],
        );
  const notifications =
    batch.notifications.length === 0
      ? state.notifications
      : set(
          state.notifications,
          surface,
          page === "first"
            ? batch.notifications
            : join(
                at(state.notifications, surface),
                batch.notifications,
                (n) => n.id,
                page === "top",
              ),
        );

  const entries = new Map(state.entries[surface] ?? []);
  const byId = new Map(batch.posts.map((p) => [p.postId, p]));
  for (const id of order) {
    const p = byId.get(id);
    if (p !== undefined) entries.set(id, { context: p.context, conversation: p.conversation });
  }

  return {
    ...state,
    entries: { ...state.entries, [surface]: entries },
    cursors,
    people,
    sections,
    listIds,
    communityIds,
    trends,
    notifications,
    lists: newer
      ? state.lists
      : set(
          state.lists,
          surface,
          again ? besideNeighbors(list, order, fresh) : [...list, ...fresh],
        ),
    waiting: newer
      ? set(state.waiting, surface, [...fresh, ...at(state.waiting, surface)])
      : state.waiting,
    nextTop: newer
      ? set(state.nextTop, surface, unique([...order, ...at(state.nextTop, surface)]))
      : state.nextTop,
  };
}

const unique = (ids: ReadonlyArray<string>) => [...new Set(ids)];

/**
 * X's top again with no new posts: a module it sent with them goes where X put it, before the
 * next listed id in X's order (or after the one before it), not at the list's end.
 */
function besideNeighbors(
  list: ReadonlyArray<string>,
  order: ReadonlyArray<string>,
  fresh: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const out = [...list];
  for (const id of fresh) {
    const i = order.indexOf(id);
    const next = order.slice(i + 1).find((x) => out.includes(x));
    const prev = order.slice(0, i).findLast((x) => out.includes(x));
    if (next !== undefined) out.splice(out.indexOf(next), 0, id);
    else if (prev !== undefined) out.splice(out.indexOf(prev) + 1, 0, id);
    else out.push(id);
  }
  return out;
}

/** Shows what waited behind the pill, on top in X's order. */
export const showWaiting = (state: EngineState, surface: AnySurface): EngineState => ({
  ...state,
  lists: set(
    state.lists,
    surface,
    unique([
      ...at(state.nextTop, surface),
      ...at(state.waiting, surface),
      ...at(state.lists, surface),
    ]),
  ),
  waiting: set(state.waiting, surface, []),
  nextTop: set(state.nextTop, surface, []),
});

/** A surface opened afresh: its order starts again from what X sends next. */
export const resetSurface = (state: EngineState, surface: AnySurface): EngineState => ({
  ...state,
  lists: set(state.lists, surface, []),
  waiting: set(state.waiting, surface, []),
  nextTop: set(state.nextTop, surface, []),
  people: set(state.people, surface, []),
  sections: set(state.sections, surface, []),
  listIds: set(state.listIds, surface, []),
  communityIds: set(state.communityIds, surface, []),
  trends: set(state.trends, surface, []),
  notifications: set(state.notifications, surface, []),
  cursors: { ...state.cursors, [surface]: undefined },
  entries: { ...state.entries, [surface]: undefined },
});

/** A listed post as `surface` shows it: the shared post with that page's context and thread place. */
export const postOn = (
  state: EngineState,
  surface: AnySurface,
  postId: string,
): EnginePost | undefined => {
  const post = state.posts.get(postId);
  const entry = state.entries[surface]?.get(postId);
  return post === undefined || entry === undefined ? post : { ...post, ...entry };
};

/** The viewer's role in a Community: "Requested" while X waits on its moderators. */
export type CommunityRole = "NonMember" | "Member" | "Moderator" | "Admin" | "Requested";

/** The viewer's role in a Community: what X took for their click, until X's capture agrees. */
export const communityRole = (state: EngineState, c: EngineCommunity) =>
  state.membership.get(c.communityId) ?? c.role;

/** Keeps the role X took for the user's join, ask or leave (see `membership`). */
export const askMembership = (
  state: EngineState,
  communityId: string,
  role: CommunityRole,
): EngineState => ({ ...state, membership: new Map(state.membership).set(communityId, role) });

/** Whether the user follows someone: what they asked X for, until X's capture agrees. */
export const youFollow = (state: EngineState, user: EngineUser) =>
  state.asked.get(user.userId) ?? user.youFollow;

/** Keeps a follow or unfollow X took for the user's click (see `asked`); null: X's word again. */
export const askFollow = (
  state: EngineState,
  userId: string,
  following: boolean | null,
): EngineState => {
  const asked = new Map(state.asked);
  if (following === null) asked.delete(userId);
  else asked.set(userId, following);
  return { ...state, asked };
};

/** The person behind a handle, once X has listed them or opened their profile. */
export const userByHandle = (state: EngineState, handle: string): EngineUser | undefined => {
  const h = handle.toLowerCase();
  for (const user of state.users.values()) if (user.handle === h) return user;
  return undefined;
};

let current = emptyEngine;
export const engineAtom = Atom.make(emptyEngine).pipe(Atom.keepAlive);

/** The account X's page is signed in as, once it has said; a screen re-renders only when it changes. */
export const viewerHandleAtom = Atom.make((get) => get(engineAtom).viewer?.handle ?? null);

/** Engine fixtures dev replayed into the store, in a browser with no desktop (DevEngineReplay). */
export const engineReplayAtom = Atom.make<ReadonlyArray<string>>([]).pipe(Atom.keepAlive);

/** Applies a change to the one store and returns it, for `useAtomSet(engineAtom)`. */
export const updateEngine = (change: (state: EngineState) => EngineState) =>
  (current = change(current));

// The engine benchmark (apps/desktop/scripts/engine-bench.mjs) reads the store through DevTools,
// and empties a surface first so a check sees what X sends now, not what an earlier run left.
if (import.meta.env.DEV && typeof window !== "undefined") {
  Reflect.set(window, "__xtendEngine", () => current);
  Reflect.set(window, "__xtendEngineReset", (surface: AnySurface) =>
    updateEngine((s) => resetSurface(s, surface)),
  );
}

/** The engine's post in the shape the reply and save calls take. */
export const toXPost = (p: EnginePost): XPost => ({
  postId: p.postId,
  url: `https://x.com/${p.author.handle}/status/${p.postId}`,
  text: p.text,
  createdAt: p.createdAt,
  lang: null,
  isReply: p.isReply,
  isRepost: p.isRepost,
  hasMedia: p.hasMedia,
  hasLink: p.hasLink,
  author: {
    userId: p.author.userId,
    handle: p.author.handle,
    name: p.author.name,
    followers: p.author.followers,
    verified: p.author.verified,
    avatarUrl: p.avatarUrl,
  },
  metrics: p.metrics,
});

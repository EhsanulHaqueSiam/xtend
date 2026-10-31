import type {
  EngineBatch,
  EngineExploreTab,
  EngineHomeTab,
  EngineList,
  EngineNotification,
  EnginePost,
  EngineTrend,
  EngineUser,
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
  | "lists";

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
  | `profile:${ProfileTab}:${string}`;
export type AnySurface = Surface | KeyedSurface;

/** @public The keyed surfaces screens read, named the way the capture keys them. */
export const searchSurface = (product: SearchProduct, query: string) =>
  `search:${product}:${query}` as const;
/** @public */
export const postSurface = (postId: string) => `post:${postId}` as const;
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
  if (op === "TweetDetail") return key === null ? ["post"] : [postSurface(key), "post"];
  if (op === "HomeTimeline") return [tabKey(key, "tag") ?? "forYou"];
  if (op === "HomeLatestTimeline") return ["following"];
  if (op === "Bookmarks") return ["bookmarks"];
  if (op === "ListsManagementPageTimeline") return ["lists"];
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
};

export interface EngineState {
  readonly posts: ReadonlyMap<string, EnginePost>;
  /** People X listed (search People, Who to follow, a profile's header), by user id. */
  readonly users: ReadonlyMap<string, EngineUser>;
  /** Post ids per surface. */
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
  readonly trends: PerSurface<EngineTrend>;
  readonly notifications: PerSurface<EngineNotification>;
  /** X Lists by id: the Lists page's rows and each List's own header. */
  readonly xLists: ReadonlyMap<string, EngineList>;
  /** List ids per surface, in X's order (the Lists page's sections follow it). */
  readonly listIds: PerSurface<string>;
  /** Home's pinned tabs after For you and Following, as X named them. */
  readonly homeTabs: ReadonlyArray<EngineHomeTab>;
  readonly exploreTabs: ReadonlyArray<EngineExploreTab>;
  /** The page cursors X last answered per surface, to tell a fetch of newer posts from the next page. */
  readonly cursors: Readonly<
    Partial<Record<AnySurface, { readonly top: string | null; readonly bottom: string | null }>>
  >;
}

export const emptyEngine: EngineState = {
  posts: new Map(),
  users: new Map(),
  lists: NONE,
  waiting: NONE,
  nextTop: NONE,
  people: NONE,
  trends: NONE,
  notifications: NONE,
  xLists: new Map(),
  listIds: NONE,
  homeTabs: [],
  exploreTabs: [],
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
  if (batch.users.length > 0) {
    const next = new Map(users);
    for (const user of batch.users) next.set(user.userId, user);
    users = next;
  }
  let xLists = state.xLists;
  if (batch.lists.length > 0) {
    const next = new Map(xLists);
    for (const list of batch.lists) next.set(list.listId, list);
    xLists = next;
  }
  const merged: EngineState = {
    ...state,
    posts,
    users,
    xLists,
    homeTabs: batch.homeTabs ?? state.homeTabs,
    exploreTabs: batch.exploreTabs ?? state.exploreTabs,
  };
  return surfacesOf(batch).reduce((state, surface) => mergeInto(state, batch, surface), merged);
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
  const quoted = new Set(batch.posts.flatMap((p) => (p.quotedId === null ? [] : [p.quotedId])));
  const known = new Set([...list, ...at(state.waiting, surface)]);
  const order = batch.posts.map((p) => p.postId).filter((id) => !quoted.has(id));
  const fresh = order.filter((id) => !known.has(id));
  const top = list[0] === undefined ? undefined : posts.get(list[0]);
  const newer =
    surface !== "post" &&
    top !== undefined &&
    fresh.length > 0 &&
    (page === "top" ||
      page === "first" ||
      (page === "unknown" && fresh.every((id) => posts.get(id)!.createdAt > top.createdAt)));

  // People, trends and notifications: a first page replaces, a newer page goes on top.
  const userIds = batch.users.map((u) => u.userId);
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

  return {
    ...state,
    cursors,
    people,
    listIds,
    trends,
    notifications,
    lists: newer ? state.lists : set(state.lists, surface, [...list, ...fresh]),
    waiting: newer
      ? set(state.waiting, surface, [...fresh, ...at(state.waiting, surface)])
      : state.waiting,
    nextTop: newer
      ? set(state.nextTop, surface, unique([...order, ...at(state.nextTop, surface)]))
      : state.nextTop,
  };
}

const unique = (ids: ReadonlyArray<string>) => [...new Set(ids)];

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
  listIds: set(state.listIds, surface, []),
  trends: set(state.trends, surface, []),
  notifications: set(state.notifications, surface, []),
  cursors: { ...state.cursors, [surface]: undefined },
});

/** The person behind a handle, once X has listed them or opened their profile. */
export const userByHandle = (state: EngineState, handle: string): EngineUser | undefined => {
  const h = handle.toLowerCase();
  for (const user of state.users.values()) if (user.handle === h) return user;
  return undefined;
};

let current = emptyEngine;
export const engineAtom = Atom.make(emptyEngine).pipe(Atom.keepAlive);

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

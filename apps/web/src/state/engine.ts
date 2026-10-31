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

/** The pages every account has. */
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

/** Pages named by what X sent: a pinned Home tab, a List, a Community, an Explore tab. */
type TabSurface = EngineHomeTab["id"] | `explore:${string}`;
export type AnySurface = Surface | TabSurface;

const OPS: Readonly<Record<string, Surface>> = {
  HomeLatestTimeline: "following",
  SearchTimeline: "search",
  TweetDetail: "post",
  Bookmarks: "bookmarks",
  // X has used each pair of names for a profile's tabs.
  UserTweets: "profile",
  UserOriginalsTimeline: "profile",
  UserTweetsAndReplies: "profile:replies",
  UserRepliesTimeline: "profile:replies",
  UserMedia: "profile:media",
  UserVideoTimeline: "profile:media",
  UserRepostsTimeline: "profile:reposts",
  UserArticlesTweets: "profile:articles",
  UserHighlightsTweets: "profile:highlights",
  UserSuperFollowTweets: "profile:subs",
  ListsManagementPageTimeline: "lists",
};

/** The capture's key for a Home tab, a Community or a List, typed as the surface it names. */
const tabKey = <P extends "tag" | "community" | "list">(key: string | null, prefix: P) =>
  key?.startsWith(`${prefix}:`) === true ? (key as `${P}:${string}`) : undefined;

/** Which surface a response feeds; undefined for the many X calls no screen lists. */
export function surfaceOf(batch: Pick<EngineBatch, "op" | "key">): AnySurface | undefined {
  const { op, key } = batch;
  if (op === "HomeTimeline") return tabKey(key, "tag") ?? "forYou";
  if (op === "CommunityTweetsTimeline") return tabKey(key, "community");
  if (op === "ListLatestTweetsTimeline") return tabKey(key, "list");
  if (op === "NotificationsTimeline")
    return key === "Mentions"
      ? "notifications:mentions"
      : key === "Verified"
        ? "notifications:verified"
        : "notifications";
  if ((op === "ExplorePage" || op === "GenericTimelineById") && key !== null)
    return `explore:${key}`;
  return OPS[op];
}

type PerSurface<A> = Readonly<Record<Surface, ReadonlyArray<A>>> &
  Readonly<Partial<Record<TabSurface, ReadonlyArray<A>>>>;

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
  /** User ids per surface. */
  readonly people: PerSurface<string>;
  readonly trends: PerSurface<EngineTrend>;
  readonly notifications: PerSurface<EngineNotification>;
  /** X Lists by id: the Lists page's rows and each List's own header. */
  readonly xLists: ReadonlyMap<string, EngineList>;
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
  people: NONE,
  trends: NONE,
  notifications: NONE,
  xLists: new Map(),
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
  const surface = surfaceOf(batch);
  if (surface === undefined) return merged;

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
  const fresh = batch.posts.map((p) => p.postId).filter((id) => !known.has(id) && !quoted.has(id));
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
    ...merged,
    cursors,
    people,
    trends,
    notifications,
    lists: newer ? state.lists : set(state.lists, surface, [...list, ...fresh]),
    waiting: newer
      ? set(state.waiting, surface, [...fresh, ...at(state.waiting, surface)])
      : state.waiting,
  };
}

/** Shows what waited behind the pill, on top. */
export const showWaiting = (state: EngineState, surface: AnySurface): EngineState => ({
  ...state,
  lists: set(state.lists, surface, [...at(state.waiting, surface), ...at(state.lists, surface)]),
  waiting: set(state.waiting, surface, []),
});

/** A surface opened afresh: its order starts again from what X sends next. */
export const resetSurface = (state: EngineState, surface: AnySurface): EngineState => ({
  ...state,
  lists: set(state.lists, surface, []),
  waiting: set(state.waiting, surface, []),
  people: set(state.people, surface, []),
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

// The engine benchmark (apps/desktop/scripts/engine-bench.mjs) reads the store through DevTools.
if (import.meta.env.DEV && typeof window !== "undefined")
  Reflect.set(window, "__xtendEngine", () => current);

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

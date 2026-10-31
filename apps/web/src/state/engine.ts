import type { EngineBatch, EnginePost, XPost } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";

/**
 * What the X engine (the off-screen x.com webview) has shown, for Xtend's own X screens: every
 * post by id, and per surface the order X gave them. Fed by the desktop's capture, one GraphQL
 * response at a time; nothing here calls X.
 */

export type Surface = "forYou" | "following" | "search" | "post";

const SURFACES: Readonly<Record<string, Surface>> = {
  HomeTimeline: "forYou",
  HomeLatestTimeline: "following",
  SearchTimeline: "search",
  TweetDetail: "post",
};

const NO_LISTS: Readonly<Record<Surface, ReadonlyArray<string>>> = {
  forYou: [],
  following: [],
  search: [],
  post: [],
};

export interface EngineState {
  readonly posts: ReadonlyMap<string, EnginePost>;
  readonly lists: Readonly<Record<Surface, ReadonlyArray<string>>>;
  /** Newer posts X fetched for a list's top; they wait behind a pill instead of shifting the list. */
  readonly waiting: Readonly<Record<Surface, ReadonlyArray<string>>>;
}

export const emptyEngine: EngineState = { posts: new Map(), lists: NO_LISTS, waiting: NO_LISTS };

/**
 * Folds one response into the store. Posts that appear only as a quote inside another stay out
 * of the list; a batch wholly newer than the list's top is X's "new posts" fetch and waits.
 */
export function mergeBatch(state: EngineState, batch: EngineBatch): EngineState {
  const posts = new Map(state.posts);
  for (const post of batch.posts) posts.set(post.postId, post);
  const surface = SURFACES[batch.op];
  if (surface === undefined) return { ...state, posts };
  const quoted = new Set(batch.posts.flatMap((p) => (p.quotedId === null ? [] : [p.quotedId])));
  const list = state.lists[surface];
  const known = new Set([...list, ...state.waiting[surface]]);
  const fresh = batch.posts.map((p) => p.postId).filter((id) => !known.has(id) && !quoted.has(id));
  const top = list[0] === undefined ? undefined : posts.get(list[0]);
  const newer =
    surface !== "post" &&
    top !== undefined &&
    fresh.length > 0 &&
    fresh.every((id) => posts.get(id)!.createdAt > top.createdAt);
  return {
    posts,
    lists: newer ? state.lists : { ...state.lists, [surface]: [...list, ...fresh] },
    waiting: newer
      ? { ...state.waiting, [surface]: [...fresh, ...state.waiting[surface]] }
      : state.waiting,
  };
}

/** Shows what waited behind the pill, on top. */
export const showWaiting = (state: EngineState, surface: Surface): EngineState => ({
  ...state,
  lists: { ...state.lists, [surface]: [...state.waiting[surface], ...state.lists[surface]] },
  waiting: { ...state.waiting, [surface]: [] },
});

/** A surface opened afresh: its order starts again from what X sends next. */
export const resetSurface = (state: EngineState, surface: Surface): EngineState => ({
  ...state,
  lists: { ...state.lists, [surface]: [] },
  waiting: { ...state.waiting, [surface]: [] },
});

let current = emptyEngine;
export const engineAtom = Atom.make(emptyEngine).pipe(Atom.keepAlive);

/** Applies a change to the one store and returns it, for `useAtomSet(engineAtom)`. */
export const updateEngine = (change: (state: EngineState) => EngineState) =>
  (current = change(current));

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

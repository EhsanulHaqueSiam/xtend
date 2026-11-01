import type { ObservedPost } from "@xtend/contracts";
import type * as Electron from "electron";

import {
  OVERLAY_DATA_CHANNEL,
  OVERLAY_HIDE_CHANNEL,
  type OverlayData,
  type OverlayPost,
} from "../ipc/channels.ts";

const MAX_POSTS = 2_000;
const STALE_MS = 60 * 60 * 1_000;

/**
 * Main-process side of the overlay: per-post strip data for the preload and the viewer's averages.
 * Pulls the overlay when the normalizer is quiet for an hour while the page navigates: X changed
 * shapes, and stale numbers are worse than none.
 */
export function createOverlayFeed(contents: Electron.WebContents) {
  const posts = new Map<string, ObservedPost>();
  const own = new Map<string, OverlayPost>();
  let lastRecognizedAt = Date.now();
  let hidden = false;

  const ownAverage = (): OverlayData["ownAverage"] => {
    if (own.size === 0) return null;
    let views = 0;
    let er = 0;
    for (const p of own.values()) {
      const v = p.views ?? 0;
      views += v;
      er += v === 0 ? 0 : (p.likes + p.reposts + p.replies + p.quotes + p.bookmarks) / v;
    }
    return { views: views / own.size, er: er / own.size };
  };

  const setHidden = (next: boolean) => {
    if (next === hidden) return;
    hidden = next;
    contents.send(OVERLAY_HIDE_CHANNEL, hidden);
  };

  return {
    /** Called with every batch the capture recognized. */
    observe: (batch: ReadonlyArray<ObservedPost>, viewerHandle: string | null) => {
      lastRecognizedAt = Date.now();
      setHidden(false);
      const fresh: Record<string, OverlayPost> = {};
      for (const p of batch) {
        const post: OverlayPost = {
          ...p.metrics,
          createdAt: p.createdAt,
          authorHandle: p.author.handle,
          authorFollowers: p.author.followers,
          authorVerified: p.author.verified,
          isOwn: viewerHandle !== null && p.author.handle === viewerHandle,
          isPromoted: p.isPromoted,
        };
        posts.set(p.postId, p);
        fresh[p.postId] = post;
        if (post.isOwn && !p.isRepost) own.set(p.postId, post);
      }
      // Bounded by dropping the oldest insertions; a scrolled-past post is rarely revisited.
      for (const key of posts.keys()) {
        if (posts.size <= MAX_POSTS) break;
        posts.delete(key);
      }
      contents.send(OVERLAY_DATA_CHANNEL, { posts: fresh, ownAverage: ownAverage() });
    },
    /** Called on every navigation; the kill switch only trips while the user keeps browsing. */
    navigated: () => setHidden(Date.now() - lastRecognizedAt > STALE_MS),
    /** The post as the capture last saw it, for the Save action. */
    get: (postId: string): ObservedPost | undefined => posts.get(postId),
  };
}

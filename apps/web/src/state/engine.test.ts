import type { EnginePost } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { emptyEngine, mergeBatch, showWaiting } from "./engine";

const post = (postId: string, createdAt: string, quotedId: string | null = null): EnginePost => ({
  postId,
  author: { userId: "1", handle: "ann", name: "Ann", followers: 10, verified: false },
  text: postId,
  createdAt,
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 1, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  avatarUrl: null,
  media: [],
  quotedId,
  replyToId: null,
});

it("keeps X's order, leaves quoted posts out of the list, and holds newer posts behind the pill", () => {
  let state = mergeBatch(emptyEngine, {
    op: "HomeLatestTimeline",
    posts: [
      post("2", "2026-10-31T02:00:00Z", "9"),
      post("9", "2026-10-30T00:00:00Z"),
      post("1", "2026-10-31T01:00:00Z"),
    ],
  });
  expect(state.lists.following).toEqual(["2", "1"]);
  expect(state.posts.has("9")).toBe(true);

  // The next page, with one post already shown: only the new one joins, at the bottom.
  state = mergeBatch(state, {
    op: "HomeLatestTimeline",
    posts: [post("1", "2026-10-31T01:00:00Z"), post("0", "2026-10-30T23:00:00Z")],
  });
  expect(state.lists.following).toEqual(["2", "1", "0"]);

  // X's "new posts" fetch: everything newer than the top waits.
  state = mergeBatch(state, {
    op: "HomeLatestTimeline",
    posts: [post("3", "2026-10-31T03:00:00Z")],
  });
  expect(state.lists.following).toEqual(["2", "1", "0"]);
  expect(state.waiting.following).toEqual(["3"]);
  state = showWaiting(state, "following");
  expect(state.lists.following).toEqual(["3", "2", "1", "0"]);

  // An operation no screen draws only feeds the store.
  state = mergeBatch(state, { op: "UserTweets", posts: [post("7", "2026-10-29T00:00:00Z")] });
  expect(state.posts.has("7")).toBe(true);
  expect(state.lists.forYou).toEqual([]);
});

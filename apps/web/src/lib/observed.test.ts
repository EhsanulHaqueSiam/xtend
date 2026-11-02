import type { ObservedPostSummary } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { observedAuthors, observedMatching, observedSimilar } from "./observed";

const post = (postId: string, text: string): ObservedPostSummary => ({
  postId,
  text,
  author: { userId: "1", handle: "a", name: "A", followers: null, verified: false },
  createdAt: "2026-10-28T00:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  firstSeenAt: "2026-10-28T00:00:00.000Z",
  lastSeenAt: "2026-10-28T00:00:00.000Z",
  observations: 1,
});

it("matches X's query the way X does: words, phrases, OR, from:, minus and counts", () => {
  const posts = [
    post("1", "Electron views are hard"),
    { ...post("2", "views on pricing"), author: { ...post("2", "").author, handle: "Bea" } },
    { ...post("3", "pricing views, honestly"), metrics: { ...post("3", "").metrics, likes: 50 } },
  ];
  const ids = (query: string) => observedMatching(posts, query).map((p) => p.postId);
  expect(ids("electron views")).toEqual(["1"]);
  expect(ids("from:bea")).toEqual(["2"]);
  expect(ids('"views on"')).toEqual(["2"]);
  expect(ids("electron OR pricing")).toEqual(["1", "2", "3"]);
  expect(ids("views -electron")).toEqual(["2", "3"]);
  expect(ids("views min_faves:10")).toEqual(["3"]);
  expect(ids("min_faves:10")).toEqual([]);
});

it("finds seen posts sharing two longer words, most shared first, and skips ads", () => {
  const posts = [
    post("1", "Shipped the pricing page today"),
    post("2", "Pricing page teardown: shipped in a week, signups doubled"),
    { ...post("3", "Shipped pricing page signups"), isPromoted: true },
    post("4", "The of and a"),
  ];
  expect(
    observedSimilar(posts, "Shipped the new pricing page, 40 signups").map((p) => p.postId),
  ).toEqual(["2", "1"]);
  expect(observedSimilar(posts, "nothing alike here")).toEqual([]);
});

it("lists each author the session saw matching a search once, above a follower floor", () => {
  const by = (postId: string, handle: string, followers: number, text: string) => ({
    ...post(postId, text),
    author: { userId: postId, handle, name: handle, followers, verified: false },
  });
  const posts = [
    by("1", "ann", 5000, "typefully alternative?"),
    by("2", "ann", 5000, "still need a typefully alternative"),
    by("3", "bob", 10, "typefully alternative pls"),
    by("4", "cy", 9000, "unrelated"),
  ];
  expect(observedAuthors(posts, "typefully alternative", 100)).toEqual([
    { handle: "ann", name: "ann", userId: "1", followers: 5000, bio: "" },
  ]);
});

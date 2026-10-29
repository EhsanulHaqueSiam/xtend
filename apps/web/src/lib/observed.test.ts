import type { ObservedPostSummary } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { observedMatching, observedSimilar } from "./observed";

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

it("matches every plain word and ignores X's operators", () => {
  const posts = [post("1", "Electron views are hard"), post("2", "views on pricing")];
  expect(observedMatching(posts, "electron views").map((p) => p.postId)).toEqual(["1"]);
  expect(observedMatching(posts, "views from:a min_faves:10").map((p) => p.postId)).toEqual([
    "1",
    "2",
  ]);
  expect(observedMatching(posts, "from:a")).toEqual([]);
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

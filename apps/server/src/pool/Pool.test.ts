import { describe, expect, it } from "@effect/vitest";
import type { ObservedPost } from "@xtend/contracts";

import { toItems } from "./Pool.ts";

const post = (patch: Partial<ObservedPost>): ObservedPost => ({
  postId: "1",
  author: { userId: "5", handle: "levelsio", name: "Pieter", followers: 10, verified: true },
  text: "hi",
  createdAt: "2026-10-22T04:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 1, likes: 2, reposts: 3, replies: 4, quotes: 5, bookmarks: 6 },
  ...patch,
});

describe("Pool", () => {
  it("sends public posts with their author and numbers; ads, reposts and protected accounts stay home", () => {
    const items = toItems([
      post({}),
      post({ postId: "2", isPromoted: true }),
      post({ postId: "3", isRepost: true }),
      post({ postId: "4", author: { ...post({}).author, isProtected: true } }),
    ]);
    expect(items).toEqual([
      {
        post: {
          postId: "1",
          text: "hi",
          createdAt: "2026-10-22T04:00:00.000Z",
          isReply: false,
          hasMedia: false,
          hasLink: false,
          author: {
            userId: "5",
            handle: "levelsio",
            name: "Pieter",
            followers: 10,
            verified: true,
          },
        },
        metrics: { views: 1, likes: 2, reposts: 3, replies: 4, quotes: 5, bookmarks: 6 },
      },
    ]);
  });
});

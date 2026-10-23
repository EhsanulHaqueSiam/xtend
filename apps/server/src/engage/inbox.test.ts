import { describe, expect, it } from "vite-plus/test";
import type { ObservedPostSummary } from "@xtend/contracts";

import { matchIncoming } from "./inbox.ts";

const seen = (
  postId: string,
  handle: string,
  text: string,
  isReply: boolean,
): ObservedPostSummary => ({
  postId,
  text,
  createdAt: "2026-10-22T09:00:00.000Z",
  isReply,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  firstSeenAt: "2026-10-22T09:00:00.000Z",
  lastSeenAt: "2026-10-22T09:00:00.000Z",
  observations: 1,
  author: { userId: postId, handle, name: handle, followers: 10, verified: false },
  metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

describe("matchIncoming", () => {
  it("keeps replies addressed to the user and quotes of their posts, never their own", () => {
    const posts = [
      seen("1", "alice", "@SiamShips good point", true),
      seen("2", "bob", "nice thread @other", true),
      seen("3", "carol", "this https://x.com/siamships/status/99 aged well", false),
      seen("4", "siamships", "@alice thanks", true),
      seen("5", "dave", "@siamships but not a reply", false),
    ];
    expect(matchIncoming(posts, "siamships").map((p) => p.postId)).toEqual(["1", "3"]);
    expect(matchIncoming(posts, "siamships")[0]?.url).toBe("https://x.com/alice/status/1");
  });
});

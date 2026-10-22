import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Treg from "./Treg.ts";
import * as XClient from "./XClient.ts";

// A treg stub that answers the search endpoint with one anyapi-shaped row.
const tregStub = Layer.succeed(Treg.Treg)({
  isCached: () => Effect.succeed(false),
  call: (input) =>
    Effect.succeed({
      status: 200,
      cached: false,
      costUsd: 0.0004,
      body:
        input.endpoint === "anyapi.x.search.posts"
          ? {
              output: {
                data: {
                  items: [
                    {
                      id: "2112103712584090069",
                      url: "https://x.com/i/web/status/2112103712584090069",
                      text: "Save this https://t.co/abc",
                      createdUtc: 1792399740,
                      lang: "ja",
                      isReply: false,
                      authorId: "2042103180478001153",
                      authorUsername: "studio_dev",
                      authorName: "Studio",
                      authorFollowers: 42713,
                      authorVerified: true,
                      media: [{ type: "video" }],
                      likeCount: 2025,
                      retweetCount: 207,
                      replyCount: 12,
                      quoteCount: 18,
                      bookmarkCount: 2775,
                      viewCount: 161377,
                    },
                  ],
                  nextCursor: "cur_1",
                },
              },
            }
          : {},
    }),
});

const layer = Layer.effect(XClient.XClient, XClient.make).pipe(Layer.provide(tregStub));

describe("XClient", () => {
  it.effect("normalizes an anyapi search row into an XPost", () =>
    Effect.gen(function* () {
      const x = yield* XClient.XClient;
      const page = yield* x.searchPosts("graph tools", { purpose: "test" });
      expect(page.nextCursor).toBe("cur_1");
      expect(page.items).toHaveLength(1);
      const post = page.items[0]!;
      expect(post.author.handle).toBe("studio_dev");
      expect(post.hasMedia).toBe(true);
      expect(post.hasLink).toBe(true);
      expect(post.metrics).toEqual({
        views: 161377,
        likes: 2025,
        reposts: 207,
        replies: 12,
        quotes: 18,
        bookmarks: 2775,
      });
      expect(post.createdAt).toBe("2026-10-19T08:49:00.000Z");
    }).pipe(Effect.provide(layer)),
  );

  it("prices a post with a link at X's URL rate, but not one that merely names Node.js", () => {
    expect(XClient.postCostUsd("plain text")).toBe(0.015);
    expect(XClient.postCostUsd("see xtend.app")).toBe(0.2);
    expect(XClient.postCostUsd("https://x.com/a")).toBe(0.2);
    expect(XClient.postCostUsd("I ship Node.js and React.tsx things")).toBe(0.015);
  });
});

import { describe, expect, it } from "@effect/vitest";

import {
  isViewerOperation,
  normalizeGraphqlResponse,
  readViewerHandle,
  sourceFromOperation,
  xDateToIso,
} from "./normalizeGraphql.ts";

const tweet = (id: string, overrides: Record<string, unknown> = {}) => ({
  __typename: "Tweet",
  rest_id: id,
  core: {
    user_results: {
      result: {
        rest_id: "44196397",
        is_blue_verified: true,
        core: { screen_name: "levelsio", name: "Pieter Levels" },
        privacy: { protected: false },
        legacy: { followers_count: 621000 },
      },
    },
  },
  views: { count: "1100000" },
  legacy: {
    full_text: "Shipped the thing.",
    created_at: "Wed Oct 22 04:00:00 +0000 2026",
    favorite_count: 9800,
    retweet_count: 1200,
    reply_count: 412,
    quote_count: 40,
    bookmark_count: 900,
    entities: { urls: [] },
  },
  ...overrides,
});

describe("normalizeGraphqlResponse", () => {
  it("finds tweets anywhere in a timeline response and reads the 2025 user shape", () => {
    const body = {
      data: {
        home: {
          home_timeline_urt: {
            instructions: [
              {
                entries: [
                  { content: { itemContent: { tweet_results: { result: tweet("1") } } } },
                  {
                    content: {
                      itemContent: {
                        tweet_results: {
                          // X's inner tweet carries no __typename of its own.
                          result: {
                            __typename: "TweetWithVisibilityResults",
                            tweet: { ...tweet("2"), __typename: undefined },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    };
    const posts = normalizeGraphqlResponse(body);
    expect(posts.map((p) => p.postId)).toEqual(["1", "2"]);
    expect(posts[0]).toMatchObject({
      author: {
        userId: "44196397",
        handle: "levelsio",
        name: "Pieter Levels",
        followers: 621000,
        verified: true,
        isProtected: false,
      },
      text: "Shipped the thing.",
      createdAt: "2026-10-22T04:00:00.000Z",
      metrics: {
        views: 1100000,
        likes: 9800,
        reposts: 1200,
        replies: 412,
        quotes: 40,
        bookmarks: 900,
      },
      isReply: false,
      hasMedia: false,
      hasLink: false,
    });
  });

  it("reads the legacy user shape, long text, media, links and replies", () => {
    const body = tweet("3", {
      core: {
        user_results: {
          result: {
            rest_id: "10",
            legacy: { screen_name: "old_shape", name: "Old", followers_count: 5, protected: true },
          },
        },
      },
      note_tweet: { note_tweet_results: { result: { text: "The whole long post." } } },
      views: {},
      legacy: {
        full_text: "The whole long…",
        created_at: "Wed Oct 22 04:00:00 +0000 2026",
        in_reply_to_status_id_str: "2",
        favorite_count: 1,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        bookmark_count: 0,
        entities: { urls: [{ expanded_url: "https://example.com" }] },
        extended_entities: { media: [{ type: "photo" }] },
      },
    });
    const [post] = normalizeGraphqlResponse(body);
    expect(post).toMatchObject({
      author: {
        handle: "old_shape",
        name: "Old",
        followers: 5,
        verified: false,
        isProtected: true,
      },
      text: "The whole long post.",
      isReply: true,
      hasMedia: true,
      hasLink: true,
      metrics: { views: null },
    });
  });

  it("drops tweets without an author or a valid date instead of guessing", () => {
    expect(normalizeGraphqlResponse(tweet("4", { core: {} }))).toEqual([]);
    expect(
      normalizeGraphqlResponse(
        tweet("5", { legacy: { ...tweet("5").legacy, created_at: "nope" } }),
      ),
    ).toEqual([]);
  });

  it("drops a post whose counts X renamed rather than recording zeros", () => {
    const { favorite_count: _, ...renamed } = tweet("6").legacy;
    expect(normalizeGraphqlResponse(tweet("6", { legacy: renamed }))).toEqual([]);
    expect(
      normalizeGraphqlResponse(tweet("6", { legacy: { ...renamed, like_count: 9800 } })),
    ).toEqual([]);
    expect(
      normalizeGraphqlResponse(tweet("6", { legacy: { ...renamed, favorite_count: -1 } })),
    ).toEqual([]);
  });

  it("reads counts sent as digit strings, and leaves views null unless X sent a number", () => {
    const { bookmark_count: _, ...legacy } = tweet("7").legacy;
    const [post] = normalizeGraphqlResponse(
      tweet("7", { legacy: { ...legacy, favorite_count: "12" }, views: { count: "" } }),
    );
    expect(post?.metrics).toEqual({
      views: null,
      likes: 12,
      reposts: 1200,
      replies: 412,
      quotes: 40,
      bookmarks: 0,
    });
    const [hidden] = normalizeGraphqlResponse(tweet("7", { views: { state: "Enabled" } }));
    expect(hidden?.metrics.views).toBeNull();
  });

  it("skips tombstones and keeps one post per id when a response repeats it", () => {
    const body = {
      entries: [
        { tweet_results: { result: tweet("1") } },
        { tweet_results: { result: { __typename: "TweetTombstone", tombstone: { text: {} } } } },
        { tweet_results: { result: tweet("2", { quoted_status_result: { result: tweet("1") } }) } },
      ],
    };
    expect(normalizeGraphqlResponse(body).map((p) => p.postId)).toEqual(["1", "2"]);
  });

  it("flags retweet wrappers and promoted items, and lowercases handles", () => {
    const original = tweet("7", {
      core: {
        user_results: {
          result: {
            rest_id: "9",
            core: { screen_name: "SomeOne", name: "Someone" },
            legacy: { followers_count: 5 },
          },
        },
      },
    });
    const wrapper = tweet("8", {
      legacy: {
        ...tweet("8").legacy,
        full_text: "RT @SomeOne: Shipped the thing.",
        created_at: "Wed Oct 22 05:00:00 +0000 2026",
        retweeted_status_result: { result: original },
      },
    });
    const body = {
      entries: [
        { content: { itemContent: { tweet_results: { result: wrapper } } } },
        {
          content: {
            itemContent: {
              promotedMetadata: { advertiser_results: {} },
              tweet_results: {
                result: tweet("3", { quoted_status_result: { result: tweet("11") } }),
              },
            },
          },
        },
      ],
    };
    const posts = normalizeGraphqlResponse(body);
    // The post an ad quotes is organic.
    expect(posts.map((p) => [p.postId, p.isRepost, p.isPromoted])).toEqual([
      ["8", true, false],
      ["7", false, false],
      ["3", false, true],
      ["11", false, false],
    ]);
    expect(posts[1]?.author.handle).toBe("someone");
  });

  it("reads the viewer handle from the Viewer operation", () => {
    expect(isViewerOperation("https://x.com/i/api/graphql/abc/Viewer?variables=%7B%7D")).toBe(true);
    expect(isViewerOperation("https://x.com/i/api/graphql/abc/HomeTimeline")).toBe(false);
    const body = {
      data: { viewer: { user_results: { result: { core: { screen_name: "LevelsIO" } } } } },
    };
    expect(readViewerHandle(body)).toBe("levelsio");
    expect(readViewerHandle({ data: {} })).toBeUndefined();
  });

  it("maps operation names to sources", () => {
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/HomeTimeline?x=1")).toBe("home");
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/HomeLatestTimeline")).toBe("home");
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/UserTweets")).toBe("profile");
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/TweetDetail")).toBe("detail");
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/SearchTimeline")).toBe("search");
    expect(sourceFromOperation("https://x.com/i/api/graphql/abc/Bookmarks")).toBe("other");
  });

  it("parses X's date format", () => {
    expect(xDateToIso("Wed Oct 22 04:00:00 +0000 2026")).toBe("2026-10-22T04:00:00.000Z");
    expect(xDateToIso("garbage")).toBeUndefined();
  });
});

import { describe, expect, it } from "@effect/vitest";

import {
  hasEngineContent,
  renderEngineBatch,
  renderKnownFollowers,
  requestVariables,
} from "./engineBatch.ts";
import { normalizeGraphqlResponse } from "./normalizeGraphql.ts";

// X's 2026 user: no `legacy` block, counts and bio in their own fields.
const user = (id: string, handle: string, extra: Record<string, unknown> = {}) => ({
  __typename: "User",
  rest_id: id,
  core: {
    screen_name: handle,
    name: handle.toUpperCase(),
    created_at: "Thu Oct 13 01:18:04 +0000 2016",
  },
  avatar: { image_url: `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg` },
  banner: { image_url: `https://pbs.twimg.com/profile_banners/${id}/1` },
  profile_bio: {
    description: "Builds things",
    entities: {
      url: {
        urls: [{ display_url: "t3.gg", expanded_url: "https://t3.gg", url: "https://t.co/r" }],
      },
    },
  },
  relationship_counts: { followers: 417961, following: 4326 },
  relationship_perspectives: { following: true, followed_by: false },
  tweet_counts: { tweets: 70152 },
  is_blue_verified: true,
  privacy: { protected: false },
  pinned_items: { tweet_ids_str: ["77"] },
  location: { location: "San Francisco, CA" },
  ...extra,
});

const tweet = (
  id: string,
  legacy: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  __typename: "Tweet",
  rest_id: id,
  core: { user_results: { result: user("786375418685165568", "theo") } },
  views: { count: "1000" },
  legacy: {
    full_text: "Shipped the thing.",
    created_at: "Wed Oct 22 04:00:00 +0000 2026",
    favorite_count: 10,
    retweet_count: 2,
    reply_count: 1,
    quote_count: 0,
    entities: { urls: [] },
    ...legacy,
  },
  ...extra,
});

const item = (content: unknown, socialContext?: unknown) => ({
  content: {
    itemContent: { itemType: "TimelineTweet", socialContext, tweet_results: { result: content } },
  },
});

const binding = (key: string, value: Record<string, unknown>) => ({ key, value });

describe("renderEngineBatch posts", () => {
  it("reads the post X's composer created, which X sends without its type name", () => {
    const { __typename: _, ...created } = tweet("5", { in_reply_to_status_id_str: "9" });
    const body = { data: { create_tweet: { tweet_results: { result: created } } } };
    const [post] = renderEngineBatch("CreateTweet", {}, body).posts;
    expect([post?.postId, post?.replyToId, post?.author.handle]).toEqual(["5", "9", "theo"]);
  });

  it("draws a reply, its links and card as X does, with the viewer's own state", () => {
    const post = tweet(
      "1",
      {
        full_text: "@theo @dhh read this https://t.co/link https://t.co/card",
        display_text_range: [10, 55],
        entities: {
          user_mentions: [
            { screen_name: "theo", indices: [0, 5] },
            { screen_name: "dhh", indices: [6, 10] },
          ],
          urls: [
            { url: "https://t.co/link", expanded_url: "https://a.dev/x", display_url: "a.dev/x" },
            {
              url: "https://t.co/card",
              expanded_url: "https://bunny.net/blog",
              display_url: "bunny.net/blog",
            },
          ],
        },
        in_reply_to_status_id_str: "9",
        favorited: true,
        bookmarked: true,
      },
      {
        card: {
          legacy: {
            name: "summary_large_image",
            binding_values: [
              binding("title", { string_value: "How we cut our CI bill" }),
              binding("vanity_url", { string_value: "bunny.net" }),
              binding("description", { string_value: "Self-hosted runners." }),
              binding("card_url", { string_value: "https://t.co/card" }),
              binding("photo_image_full_size_large", {
                image_value: { url: "https://pbs.twimg.com/card_img/1" },
              }),
            ],
          },
        },
        birdwatch_pivot: { subtitle: { text: "This image is from 2019." } },
      },
    );
    const [p] = renderEngineBatch("HomeLatestTimeline", {}, { data: [item(post)] }).posts;
    expect(p).toMatchObject({
      text: "read this https://t.co/link",
      replyingTo: ["theo", "dhh"],
      card: {
        kind: "link",
        url: "https://bunny.net/blog",
        title: "How we cut our CI bill",
        domain: "bunny.net",
        description: "Self-hosted runners.",
        imageUrl: "https://pbs.twimg.com/card_img/1",
      },
      note: "This image is from 2019.",
      liked: true,
      reposted: false,
      bookmarked: true,
      context: null,
    });
    // Entities sit where the shown text has them; the card's link is drawn as the card.
    expect(p!.entities.urls.map((l) => [l.display, l.indices])).toEqual([
      ["a.dev/x", [10, 27]],
      ["bunny.net/blog", null],
    ]);
  });

  it("reads a unified card, an X Article and a poll", () => {
    const unified = {
      type: "image_website",
      component_objects: {
        details_1: {
          type: "details",
          data: {
            title: { content: "Target Wallets" },
            subtitle: { content: "addressable.io" },
            destination: "browser_1",
          },
        },
      },
      destination_objects: {
        browser_1: { type: "browser", data: { url_data: { url: "https://www.addressable.io" } } },
      },
      media_entities: { m: { media_url_https: "https://pbs.twimg.com/media/u.png" } },
    };
    const batch = renderEngineBatch(
      "HomeTimeline",
      {},
      {
        data: [
          item(
            tweet(
              "1",
              {},
              {
                card: {
                  legacy: {
                    name: "unified_card",
                    binding_values: [
                      binding("unified_card", { string_value: JSON.stringify(unified) }),
                    ],
                  },
                },
              },
            ),
          ),
          item(
            tweet(
              "2",
              {},
              {
                card: { rest_id: "https://t.co/a" },
                article: {
                  article_results: {
                    result: {
                      rest_id: "55",
                      title: "Brand factory",
                      preview_text: "You can have a brandbook",
                      cover_media: {
                        media_info: { original_img_url: "https://pbs.twimg.com/media/c.jpg" },
                      },
                    },
                  },
                },
              },
            ),
          ),
          item(
            tweet(
              "3",
              {},
              {
                card: {
                  legacy: {
                    name: "poll3choice_text_only",
                    binding_values: [
                      binding("choice1_label", { string_value: "Yes" }),
                      binding("choice1_count", { string_value: "12" }),
                      binding("choice2_label", { string_value: "No" }),
                      binding("choice2_count", { string_value: "3" }),
                      binding("choice3_label", { string_value: "Later" }),
                      binding("choice3_count", { string_value: "0" }),
                      binding("end_datetime_utc", { string_value: "2026-11-01T12:00:00Z" }),
                      binding("counts_are_final", { boolean_value: false }),
                      binding("selected_choice", { string_value: "2" }),
                    ],
                  },
                },
              },
            ),
          ),
        ],
      },
    );
    const [u, a, poll] = batch.posts;
    expect(u!.card).toEqual({
      kind: "link",
      url: "https://www.addressable.io",
      title: "Target Wallets",
      domain: "addressable.io",
      description: null,
      imageUrl: "https://pbs.twimg.com/media/u.png",
    });
    expect(a!.card).toEqual({
      kind: "article",
      url: "https://x.com/i/article/55",
      title: "Brand factory",
      domain: null,
      description: "You can have a brandbook",
      imageUrl: "https://pbs.twimg.com/media/c.jpg",
    });
    expect(poll!.card).toBeNull();
    expect(poll!.poll).toEqual({
      choices: [
        { label: "Yes", votes: 12 },
        { label: "No", votes: 3 },
        { label: "Later", votes: 0 },
      ],
      endsAt: "2026-11-01T12:00:00.000Z",
      final: false,
      voted: 2,
    });
    // A timeline carries the Article's preview, not its body.
    expect(batch.articles).toBeUndefined();
  });

  it("reads an Article's body on its reader page: styles, links, images by media id and Markdown", () => {
    const block = (key: string, type: string, text: string, extra = {}) => ({
      key,
      type,
      text,
      inlineStyleRanges: [],
      entityRanges: [],
      data: {},
      ...extra,
    });
    const entity = (key: string, type: string, data: unknown) => ({
      key,
      value: { type, mutability: "Mutable", data },
    });
    const article = {
      rest_id: "55",
      title: "Brand factory",
      media_entities: [
        {
          media_id: "91",
          media_info: {
            original_img_url: "https://pbs.twimg.com/media/p.jpg",
            original_img_width: 1200,
            original_img_height: 800,
          },
        },
      ],
      content_state: {
        blocks: [
          block("a", "header-two", "Why brands"),
          block("b", "unstyled", "Read 🙂 the guide now", {
            inlineStyleRanges: [{ offset: 5, length: 3, style: "Bold" }],
            entityRanges: [{ offset: 9, length: 5, key: 0 }],
          }),
          block("c", "atomic", " ", { entityRanges: [{ offset: 0, length: 1, key: 1 }] }),
          block("d", "atomic", " ", { entityRanges: [{ offset: 0, length: 1, key: 2 }] }),
          // An embedded post keeps its text; a link that is not the web's is no link.
          block("e", "unstyled", "See this post", {
            entityRanges: [
              { offset: 0, length: 3, key: 3 },
              { offset: 4, length: 4, key: 4 },
            ],
          }),
        ],
        entityMap: [
          entity("0", "LINK", { url: "https://example.com/guide" }),
          entity("1", "MEDIA", {
            mediaItems: [{ mediaId: "91", localMediaId: "5", mediaCategory: "DraftTweetImage" }],
          }),
          entity("2", "MARKDOWN", { markdown: "```ts\nconst a = 1;\n```" }),
          entity("3", "TWEET", { tweetId: "77" }),
          entity("4", "LINK", { url: "javascript:alert(1)" }),
        ],
      },
    };
    const batch = renderEngineBatch(
      "TweetResultByRestId",
      { tweetId: "2" },
      {
        data: {
          tweetResult: {
            result: tweet("2", {}, { article: { article_results: { result: article } } }),
          },
        },
      },
    );
    expect(batch.posts[0]?.card?.url).toBe("https://x.com/i/article/55");
    const none = { styles: [], links: [], images: [], markdown: null };
    expect(batch.articles).toEqual([
      {
        postId: "2",
        blocks: [
          { ...none, key: "a", type: "header-two", text: "Why brands" },
          {
            ...none,
            key: "b",
            type: "unstyled",
            text: "Read 🙂 the guide now",
            styles: [{ offset: 5, length: 3, style: "Bold" }],
            links: [{ offset: 9, length: 5, url: "https://example.com/guide" }],
          },
          {
            ...none,
            key: "c",
            type: "atomic",
            text: " ",
            images: [{ url: "https://pbs.twimg.com/media/p.jpg", width: 1200, height: 800 }],
          },
          { ...none, key: "d", type: "atomic", text: " ", markdown: "```ts\nconst a = 1;\n```" },
          { ...none, key: "e", type: "unstyled", text: "See this post" },
        ],
      },
    ]);
  });

  it("carries X's social context to the post below it, not to the post it quotes", () => {
    const quoted = tweet("8");
    const pinned = tweet(
      "1",
      { quoted_status_id_str: "8" },
      { quoted_status_result: { result: quoted } },
    );
    const original = tweet("2");
    const repost = tweet(
      "3",
      { retweeted_status_result: { result: original } },
      {
        core: { user_results: { result: user("5", "dhh") } },
      },
    );
    const batch = renderEngineBatch(
      "UserOriginalsTimeline",
      {},
      {
        data: [
          item(pinned, { type: "TimelineGeneralContext", contextType: "Pin", text: "Pinned" }),
          item(repost),
        ],
      },
    );
    expect(batch.posts.map((p) => [p.postId, p.context])).toEqual([
      ["1", { type: "Pin", text: "Pinned", handle: null }],
      ["8", null],
      ["2", { type: "Retweet", text: "DHH reposted", handle: "dhh" }],
    ]);
  });
});

describe("renderEngineBatch around posts", () => {
  it("reads a profile header in X's 2026 user shape", () => {
    const batch = renderEngineBatch(
      "UserByScreenName",
      { screen_name: "Theo" },
      {
        data: { user: { result: user("786375418685165568", "theo") } },
      },
    );
    expect(batch.key).toBe("theo");
    expect(batch.users).toEqual([
      {
        userId: "786375418685165568",
        handle: "theo",
        name: "THEO",
        avatarUrl: "https://pbs.twimg.com/profile_images/786375418685165568/a_normal.jpg",
        bannerUrl: "https://pbs.twimg.com/profile_banners/786375418685165568/1",
        bio: "Builds things",
        location: "San Francisco, CA",
        website: { url: "https://t3.gg", display: "t3.gg" },
        joinedAt: "2016-10-13T01:18:04.000Z",
        followers: 417961,
        following: 4326,
        posts: 70152,
        verified: true,
        isProtected: false,
        youFollow: true,
        followsYou: false,
        pinnedPostId: "77",
        verifiedType: null,
        avatarShape: "Circle",
        affiliate: null,
      },
    ]);
    // The observation path reads the same followers count.
    const [observed] = normalizeGraphqlResponse({ data: tweet("1") });
    expect(observed!.author.followers).toBe(417961);
  });

  it("reads notifications, trends with their section, Lists and cursors", () => {
    const batch = renderEngineBatch(
      "NotificationsTimeline",
      { timeline_type: "Mentions", cursor: "c0" },
      {
        data: {
          instructions: [
            {
              entries: [
                {
                  content: {
                    entryType: "TimelineTimelineCursor",
                    cursorType: "Top",
                    value: "top1",
                  },
                },
                {
                  content: {
                    itemContent: {
                      itemType: "TimelineNotification",
                      id: "n1",
                      notification_icon: "heart_icon",
                      rich_message: { text: "YASIR liked your reply" },
                      timestamp_ms: "2026-10-27T08:20:14.612Z",
                      template: {
                        from_users: [{ user_results: { result: user("6", "yasir") } }],
                        target_objects: [{ tweet_results: { result: tweet("40") } }],
                      },
                    },
                  },
                },
                item(tweet("41")),
                {
                  content: {
                    entryType: "TimelineTimelineModule",
                    header: { text: "Today's News" },
                    items: [
                      {
                        item: {
                          itemContent: {
                            itemType: "TimelineTrend",
                            name: "OpenCode",
                            social_context: {
                              text: "18 hours ago · News",
                              contextImageUrls: ["https://pbs.twimg.com/a.jpg"],
                            },
                            trend_url: { url: "twitter://trending/2116228585229042106" },
                          },
                        },
                      },
                    ],
                  },
                },
                {
                  content: {
                    itemContent: {
                      itemType: "TimelineTrend",
                      name: "Halloween",
                      trend_metadata: { domain_context: "Trending in Bangladesh" },
                      trend_url: { url: "twitter://search/?query=Halloween&src=trend_click" },
                    },
                  },
                },
                {
                  content: {
                    entryType: "TimelineTimelineModule",
                    header: { text: "Discover new Lists" },
                    items: [
                      {
                        item: {
                          itemContent: {
                            itemType: "TimelineTwitterList",
                            list: {
                              id_str: "1295892683890872320",
                              name: "Bangladesh",
                              description: "",
                              member_count: 26,
                              subscriber_count: 30545,
                              mode: "Public",
                              default_banner_media: {
                                media_info: {
                                  original_img_url: "https://pbs.twimg.com/media/b.png",
                                },
                              },
                              user_results: { result: user("7", "nation_crf") },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
                {
                  content: {
                    entryType: "TimelineTimelineCursor",
                    cursorType: "Bottom",
                    value: "bottom1",
                  },
                },
              ],
            },
          ],
        },
      },
    );
    expect([batch.key, batch.cursor, batch.top, batch.bottom]).toEqual([
      "Mentions",
      "c0",
      "top1",
      "bottom1",
    ]);
    expect(batch.notifications).toEqual([
      {
        id: "n1",
        kind: "event",
        icon: "heart_icon",
        text: "YASIR liked your reply",
        at: "2026-10-27T08:20:14.612Z",
        users: [
          {
            userId: "6",
            handle: "yasir",
            name: "YASIR",
            avatarUrl: "https://pbs.twimg.com/profile_images/6/a_normal.jpg",
          },
        ],
        postIds: ["40"],
      },
      { id: "post-41", kind: "post", icon: "", text: "", at: null, users: [], postIds: ["41"] },
    ]);
    // Both the post a notification names and the mention itself reach the posts store.
    expect(batch.posts.map((p) => p.postId)).toEqual(["40", "41"]);
    expect(batch.trends).toEqual([
      {
        name: "OpenCode",
        context: "18 hours ago · News",
        url: "https://x.com/i/trending/2116228585229042106",
        images: ["https://pbs.twimg.com/a.jpg"],
        group: "Today's News",
      },
      {
        name: "Halloween",
        context: "Trending in Bangladesh",
        url: "https://x.com/search?q=Halloween&src=trend_click",
        images: [],
        group: null,
      },
    ]);
    expect(batch.lists).toMatchObject([
      {
        listId: "1295892683890872320",
        name: "Bangladesh",
        members: 26,
        followers: 30545,
        isPrivate: false,
        bannerUrl: "https://pbs.twimg.com/media/b.png",
        owner: { handle: "nation_crf" },
        group: "Discover new Lists",
      },
    ]);
  });

  it("names Home's pinned tabs and Explore's tabs, and keys each tab's posts", () => {
    const tabs = renderEngineBatch(
      "PinnedTimelines",
      {},
      {
        data: {
          pinned_timelines: {
            pinned_timelines: [
              {
                __typename: "TagPinnedTimeline",
                tag: "1925949722688126976",
                tab_label: "Tech",
                name: "Makers and tools",
              },
              {
                __typename: "CommunityPinnedTimeline",
                community_results: {
                  result: { id_str: "1493446837214187523", name: "Build in Public" },
                },
              },
              {
                __typename: "ListPinnedTimeline",
                list: { id_str: "1295892683890872320", name: "Bangladesh" },
              },
            ],
          },
        },
      },
    );
    expect(tabs.homeTabs).toEqual([
      { id: "tag:1925949722688126976", label: "Tech" },
      { id: "community:1493446837214187523", label: "Build in Public" },
      { id: "list:1295892683890872320", label: "Bangladesh" },
    ]);
    const explore = renderEngineBatch(
      "ExplorePage",
      {},
      {
        data: {
          explore_page: {
            body: {
              timelines: [
                { id: "for_you", labelText: "Explore", timeline: { id: "VF9" } },
                { id: "trending", labelText: "Trending", timeline: { id: "VTR" } },
              ],
            },
          },
        },
      },
    );
    expect(renderEngineBatch("ExplorePage", { cursor: "" }, {}).cursor).toBeNull();
    expect([explore.key, explore.exploreTabs]).toEqual([
      "VF9",
      [
        { id: "for_you", label: "Explore", timelineId: "VF9" },
        { id: "trending", label: "Trending", timelineId: "VTR" },
      ],
    ]);
    expect(
      renderEngineBatch(
        "HomeTimeline",
        requestVariables(
          "https://x.com/i/api/graphql/q/HomeTimeline",
          '{"variables":{"tag":"19"}}',
        ),
        {},
      ).key,
    ).toBe("tag:19");
    expect(renderEngineBatch("HomeTimeline", {}, {}).key).toBeNull();
    expect(
      renderEngineBatch("SearchTimeline", { rawQuery: "from:theo", product: "Latest" }, {}).key,
    ).toBe("Latest:from:theo");
    expect(renderEngineBatch("TweetDetail", { focalTweetId: "42" }, {}).key).toBe("42");
    // A thread sorted by Recent or Likes is its own list; Relevant is X's default.
    const sorted = (rankingMode: string) =>
      renderEngineBatch("TweetDetail", { focalTweetId: "42", rankingMode }, {}).key;
    expect([sorted("Relevance"), sorted("Recency"), sorted("Likes")]).toEqual([
      "42",
      "42:Recency",
      "42:Likes",
    ]);
    // Post activity's people: who reposted and who liked post 42.
    expect(renderEngineBatch("Retweeters", { tweetId: "42", count: 20 }, {}).key).toBe("42");
    expect(renderEngineBatch("Favoriters", { tweetId: "42", count: 20 }, {}).key).toBe("42");
    // The Follow page's two tabs, as X's requests carry them; other suggestions are no tab.
    const connect = (context: string) =>
      renderEngineBatch("ConnectTabTimeline", { count: 20, context }, {}).key;
    expect([
      connect("{ }"),
      connect('{"isCreatorOnlyConnectTab" : true}'),
      connect('{"contextualUserId":"7"}'),
      connect('{"contextualUserId":"7","isCreatorOnlyConnectTab":true}'),
      connect("not json"),
      connect("[]"),
    ]).toEqual(["connect:who", "connect:creators", null, null, null, null]);
    expect(renderEngineBatch("ConnectTabTimeline", { count: 20 }, {}).key).toBeNull();
    const header = renderEngineBatch(
      "ListByRestId",
      { listId: "12" },
      {
        data: { list: { id_str: "12", name: "Bangladesh", mode: "Private", member_count: 26 } },
      },
    );
    expect([header.key, header.lists.map((l) => [l.name, l.isPrivate, l.members])]).toEqual([
      "list:12",
      [["Bangladesh", true, 26]],
    ]);
    expect(
      renderEngineBatch(
        "CommunityTweetsTimeline",
        requestVariables(
          'https://x.com/i/api/graphql/q/CommunityTweetsTimeline?variables={"communityId":"14"}',
          undefined,
        ),
        {},
      ).key,
    ).toBe("community:14");
    // A Community's Latest is its posts by Recency; Top is X's default order.
    const community = (rankingMode: string) =>
      renderEngineBatch("CommunityTweetsTimeline", { communityId: "14", rankingMode }, {}).key;
    expect([community("Relevance"), community("Recency")]).toEqual([
      "community:14",
      "community:14:Recency",
    ]);
    expect(renderEngineBatch("CommunityAboutTimeline", { communityId: "14" }, {}).key).toBe(
      "community:14",
    );
    // A search inside a Community is its own list per order and query: Top is X's by likes.
    const search = (variables: Record<string, unknown>, body: unknown = {}) =>
      renderEngineBatch(
        "CommunityTweetSearchModuleQuery",
        { communityId: "14", ...variables },
        body,
      );
    expect([
      search({ query: "ship it", timelineRankingMode: "Likes" }).key,
      search({ query: "ship it" }).key,
      search({ query: "ship it", timelineRankingMode: "Recency" }).key,
      search({}).key,
    ]).toEqual([
      "communitySearch:14:Likes:ship it",
      "communitySearch:14:Likes:ship it",
      "communitySearch:14:Recency:ship it",
      null,
    ]);
    // X's answer, in the shape a live read showed.
    const entry = (id: string) => ({
      entryId: `tweet-${id}`,
      content: {
        entryType: "TimelineTimelineItem",
        itemContent: { itemType: "TimelineTweet", tweet_results: { result: tweet(id) } },
      },
    });
    const cursor = (cursorType: string) => ({
      entryId: `cursor-${cursorType.toLowerCase()}-1`,
      content: { entryType: "TimelineTimelineCursor", value: `c-${cursorType}`, cursorType },
    });
    const found = search(
      { query: "ship it", timelineRankingMode: "Likes" },
      {
        data: {
          communityResults: {
            result: {
              community_filtered_timeline: {
                timeline: {
                  id: "CommunitySearchTopProduct-Timeline",
                  instructions: [
                    { type: "TimelineClearCache" },
                    {
                      type: "TimelineAddEntries",
                      entries: [entry("61"), entry("60"), cursor("Top"), cursor("Bottom")],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    );
    expect([found.order, found.top, found.bottom]).toEqual([["61", "60"], "c-Top", "c-Bottom"]);
    // X's Inspiration names its filters inside the timelineId. An Explore tab's id, one without a
    // language, and a cut-off one are no Inspiration: they keep the id.
    const generic = (timelineId: string) =>
      renderEngineBatch("GenericTimelineById", { timelineId, count: 20 }, {}).key;
    const others = [
      "VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=",
      "VGltZWxpbmU6DADKCwABAAAAB1JlcGxpZXMLAAYAAAAGV2Vla2x5AAA=",
      "VGltZWxpbmU6DADKCwABAAAABUxpa2VzCwACAAAAAmVuCwA=",
    ];
    expect([
      generic("VGltZWxpbmU6DADKCwABAAAABUxpa2VzCwACAAAAAmVuCwAGAAAABURhaWx5AAA="),
      generic(
        "VGltZWxpbmU6DADKCwABAAAAEVZpZGVvUXVhbGl0eVZpZXdzCwACAAAAAmVuCwAGAAAAB01vbnRobHkAAA==",
      ),
      ...others.map(generic),
    ]).toEqual([
      "inspiration:Likes:Daily:en",
      "inspiration:VideoQualityViews:Monthly:en",
      ...others,
    ]);
  });

  it("reads Communities in X's shapes: a carousel's tiles, a card, and none from a post's reference", () => {
    const banner = (url: string) => ({ media_info: { original_img_url: url } });
    const tile = (id: string, name: string) => ({
      id: "Q29tbXVuaXR5",
      result: {
        __typename: "Community",
        id_str: id,
        name,
        default_banner_media: banner(`https://pbs.twimg.com/community_banner_img/${id}.jpg`),
      },
    });
    const carousel = renderEngineBatch(
      "CarouselQuery",
      {},
      {
        data: {
          viewer_v2: {
            user_results: {
              result: {
                __typename: "User",
                community_memberships_slice: { items_results: [tile("21", "B"), tile("20", "A")] },
              },
            },
          },
        },
      },
    );
    expect(carousel.communities.map((c) => [c.communityId, c.name, c.members])).toEqual([
      ["21", "B", null],
      ["20", "A", null],
    ]);

    const card = renderEngineBatch(
      "CommunitiesFetchOneQuery",
      { communityId: "20" },
      {
        data: {
          communityResults: {
            result: {
              __typename: "Community",
              id_str: "20",
              name: "A",
              description: "Makers",
              member_count: 1200,
              join_policy: "RestrictedJoinRequestsRequireModeratorApproval",
              role: "NonMember",
              primary_community_topic: { topic_id: "1", topic_name: "Makers and tools" },
              rules: [
                { rest_id: "9", name: "Be kind", description: "No insults" },
                { name: "Stay on topic" },
              ],
              default_banner_media: banner("https://pbs.twimg.com/default.png"),
              custom_banner_media: banner("https://pbs.twimg.com/custom.jpg"),
              creator_results: { result: user("7", "maker") },
            },
          },
        },
      },
    );
    expect([card.key, card.communities]).toEqual([
      "community:20",
      [
        {
          communityId: "20",
          name: "A",
          description: "Makers",
          bannerUrl: "https://pbs.twimg.com/custom.jpg",
          members: 1200,
          topic: "Makers and tools",
          rules: [
            { name: "Be kind", description: "No insults" },
            { name: "Stay on topic", description: "" },
          ],
          joinPolicy: "RestrictedJoinRequestsRequireModeratorApproval",
          role: "NonMember",
        },
      ],
    ]);

    // A post X labels with its Community carries only the Community's id.
    const feed = renderEngineBatch(
      "CommunitiesExploreTimeline",
      {},
      {
        data: {
          instructions: [
            item(
              tweet(
                "50",
                {},
                { community_results: { result: { __typename: "Community", id_str: "20" } } },
              ),
              { type: "TimelineGeneralContext", contextType: "Community", text: "A" },
            ),
          ],
        },
      },
    );
    expect([feed.order, feed.communities, feed.posts[0]?.context?.text]).toEqual([["50"], [], "A"]);
  });

  it("reads a Community's About as X's two boxes, Moderators then Members, each with its Show more", () => {
    // X's About: one module per box, under its header, with a footer to the full list.
    const box = (entryId: string, title: string, page: string, ids: ReadonlyArray<string>) => ({
      entryId,
      sortIndex: "1",
      content: {
        __typename: "TimelineTimelineModule",
        entryType: "TimelineTimelineModule",
        displayType: "Vertical",
        header: { displayType: "Classic", sticky: true, text: title },
        footer: {
          displayType: "Classic",
          text: "Show more",
          landingUrl: {
            url: `https://twitter.com/i/communities/20/${page}`,
            urlType: "ExternalUrl",
          },
        },
        items: ids.map((id) => ({
          entryId: `${entryId.slice(0, -1)}-${id}`,
          item: {
            itemContent: {
              __typename: "TimelineUser",
              itemType: "TimelineUser",
              userDisplayType: "UserConcise",
              user_results: { result: user(id, `u${id}`) },
            },
          },
        })),
      },
    });
    const about = renderEngineBatch(
      "CommunityAboutTimeline",
      { communityId: "20" },
      {
        data: {
          communityResults: {
            result: {
              __typename: "Community",
              about_timeline: {
                timeline: {
                  instructions: [
                    { type: "TimelineClearCache" },
                    {
                      type: "TimelineAddEntries",
                      entries: [
                        box("communityModerators", "Moderators", "moderators", ["5", "6"]),
                        box("communityMembers", "Members", "members", ["3", "5", "4"]),
                      ],
                    },
                    { type: "TimelineTerminateTimeline", direction: "Top" },
                  ],
                },
              },
            },
          },
        },
      },
    );
    expect([about.key, about.people, about.sections]).toEqual([
      "community:20",
      ["5", "6", "3", "4"],
      [
        {
          title: "Moderators",
          userIds: ["5", "6"],
          link: "https://x.com/i/communities/20/moderators",
        },
        {
          title: "Members",
          userIds: ["3", "5", "4"],
          link: "https://x.com/i/communities/20/members",
        },
      ],
    ]);
  });

  it("passes on the user's Communities when X lists none, and nothing when X answered without the list", () => {
    const carousel = (slice: unknown) =>
      renderEngineBatch(
        "CarouselQuery",
        {},
        {
          data: {
            viewer_v2: { user_results: { result: { __typename: "User", ...(slice as object) } } },
          },
        },
      );
    const none = carousel({ community_memberships_slice: { items_results: [] } });
    expect([none.key, none.communities, hasEngineContent(none)]).toEqual([
      "communities:mine",
      [],
      true,
    ]);
    const unknown = carousel({});
    expect([unknown.key, hasEngineContent(unknown)]).toEqual([null, false]);
    // X's composer's audience card asks the same list under its older viewer.
    const audience = renderEngineBatch(
      "CommunitiesMembershipsSlice",
      {},
      {
        data: {
          viewer: {
            user_results: {
              result: { __typename: "User", community_memberships_slice: { items_results: [] } },
            },
          },
        },
      },
    );
    expect([audience.key, hasEngineContent(audience)]).toEqual(["communities:mine", true]);
  });

  it("reads X's news story: its headline, Grok's summary, when X updated it, and its tabs", () => {
    const story = renderEngineBatch(
      "AiTrendByRestId",
      { trendId: "1985000000000000001" },
      {
        data: {
          ai_trend_by_rest_id: {
            result: {
              rest_id: "1985000000000000001",
              page: {
                article: {
                  title: "Rays win in overtime",
                  article_text: { text: "The Rays beat..." },
                },
                last_updated_at_ms: "1793612400000",
                disclaimer: "This story is a summary of posts on X and may evolve over time.",
                post_timelines: [
                  { label: "Top", post_timeline: { id: "VGltZWxpbmU6Top" } },
                  { label: "Latest", post_timeline: { id: "VGltZWxpbmU6Latest" } },
                  { label: "Broken" },
                ],
              },
            },
          },
        },
      },
    );
    expect([story.key, story.story, hasEngineContent(story)]).toEqual([
      "1985000000000000001",
      {
        title: "Rays win in overtime",
        summary: "The Rays beat...",
        updatedAt: "2026-11-02T09:40:00.000Z",
        disclaimer: "This story is a summary of posts on X and may evolve over time.",
        timelines: [
          { label: "Top", timelineId: "VGltZWxpbmU6Top" },
          { label: "Latest", timelineId: "VGltZWxpbmU6Latest" },
        ],
      },
      true,
    ]);
    // X found no story (removed, or not one X shows this account): nothing to pass on.
    const none = renderEngineBatch("AiTrendByRestId", { trendId: "1" }, { data: {} });
    expect([none.story, hasEngineContent(none)]).toEqual([undefined, false]);
  });

  it("reads a day X's NBA schedule answered with no games as empty, and an error alone as nothing", () => {
    const empty = renderEngineBatch(
      "NBASchedule",
      { limit: 500 },
      { data: { nba_schedule: { games: [] } } },
    );
    expect([empty.games, hasEngineContent(empty)]).toEqual([[], true]);
    const failed = renderEngineBatch("NBASchedule", { limit: 500 }, { errors: [{}] });
    expect([failed.games, hasEngineContent(failed)]).toEqual([undefined, false]);
  });

  it("reads X's NBA standings in X's order within each division, and stat leaders by rank", () => {
    const team = (id: string, wins: number, losses: number, rank: number | null) => ({
      team: { rest_id: id },
      abbreviation: `T${id}`,
      name: `Team ${id}`,
      wins,
      losses,
      division_rank: rank,
      games_behind_division: rank === 1 ? 0 : 2.5,
      home: { wins: 10, losses: 3 },
      last_10: { wins: 7, losses: 3 },
      points_for: 116.2,
      streak: "W3",
    });
    const standings = renderEngineBatch(
      "NBAStandings",
      {},
      {
        data: {
          nba_standings: {
            conferences: [
              {
                conference: { rest_id: "1", name: "", alias: "East" },
                divisions: [
                  {
                    division: { rest_id: "11", name: "Atlantic" },
                    // X's rank first; without one, games over .500, then wins.
                    teams: [
                      team("3", 20, 10, null),
                      team("2", 22, 8, 2),
                      team("1", 25, 5, 1),
                      team("4", 21, 12, null),
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    );
    const east = standings.standings![0]!;
    expect([east.name, east.divisions[0]!.name]).toEqual(["East", "Atlantic"]);
    expect(east.divisions[0]!.teams.map((t) => t.abbreviation)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(east.divisions[0]!.teams[0]).toEqual({
      teamId: "1",
      abbreviation: "T1",
      name: "Team 1",
      wins: 25,
      losses: 5,
      gamesBack: 0,
      home: { wins: 10, losses: 3 },
      road: null,
      division: null,
      conference: null,
      pointsFor: 116.2,
      pointsAgainst: null,
      pointDiff: null,
      streak: "W3",
      lastTen: { wins: 7, losses: 3 },
    });
    const leaders = renderEngineBatch(
      "NBALeaders",
      { limit: 25 },
      {
        data: {
          nba_leaders: {
            categories: [
              {
                key: "points",
                name: "Points Per Game",
                leaders: [
                  {
                    rank: 2,
                    display_value: "31.8",
                    player: { info: { full_name: "S. Alexander", position: "G" } },
                  },
                  { rank: 1, display_value: "32.5", name: "L. Doncic", position: "G" },
                ],
              },
              { key: "empty", name: "Blocks", leaders: [] },
            ],
          },
        },
      },
    );
    expect([leaders.leaders, hasEngineContent(leaders)]).toEqual([
      [
        {
          key: "points",
          title: "Points Per Game",
          leaders: [
            { rank: 1, name: "L. Doncic", position: "G", value: "32.5", headshotUrl: null },
            { rank: 2, name: "S. Alexander", position: "G", value: "31.8", headshotUrl: null },
          ],
        },
      ],
      true,
    ]);
  });

  it("reads X's Post Analytics for the post asked about, a metric X sent without a value as 0", () => {
    const activity = renderEngineBatch(
      "TweetActivityQuery",
      {
        restId: "42",
        from_time: "2026-10-30T08:00:00.000Z",
        requested_organic_metrics: ["DetailExpands", "Engagements", "Follows", "Impressions"],
      },
      {
        data: {
          tweet_result_by_rest_id: {
            id: "VHdlZXQ6NDI=",
            result: {
              __typename: "Tweet",
              id: "VHdlZXQ6NDI=",
              datapoints_grid: [
                { metric_type: "DetailExpands", metric_value: 31 },
                { metric_type: "Engagements", metric_value: 118 },
                { metric_type: "Follows" },
                { metric_type: "Impressions", metric_value: 4020 },
                { metric_type: "LinkClicks", metric_value: 3 },
                { metric_type: "ProfileVisits", metric_value: 9 },
              ],
              promotion_info: [{ metric_type: "Impressions", metric_value: 0 }],
              video: [],
            },
          },
        },
      },
    );
    expect([activity.key, activity.analytics, hasEngineContent(activity)]).toEqual([
      "42",
      {
        DetailExpands: 31,
        Engagements: 118,
        Follows: 0,
        Impressions: 4020,
        LinkClicks: 3,
        ProfileVisits: 9,
      },
      true,
    ]);
    // X answered without the numbers (a post that is not the user's): nothing to pass on.
    const none = renderEngineBatch("TweetActivityQuery", { restId: "42" }, { data: {} });
    expect([none.analytics, hasEngineContent(none)]).toEqual([undefined, false]);
  });

  it("reads X's account overview by day as X's page counts it", () => {
    const day = (n: number) => Date.UTC(2026, 9, 27 + n);
    const row = (n: number, engagement_type: string, count: number, verified = "false") => ({
      timestamp: day(n),
      engagement_type,
      count,
      is_engaging_user_verified: verified,
    });
    const follows = (n: number, Follows: number, Unfollows: number) => ({
      timestamp: { iso8601_time: new Date(day(n)).toISOString() },
      metric_values: [
        { metric_type: "Follows", metric_value: Follows },
        { metric_type: "Unfollows", metric_value: Unfollows },
      ],
    });
    const overview = renderEngineBatch(
      "accountOverviewDailyQuery",
      { current_from: day(0), current_to: day(3), prev_from: day(-3), prev_to: day(0) },
      {
        data: {
          viewer_v2: {
            user_results: {
              result: {
                __typename: "User",
                verified_follower_count: 4,
                relationship_counts: { followers: 120 },
                current_time_series: [
                  row(0, "Displayed", 300),
                  row(0, "Displayed", 20, "true"),
                  row(0, "Retweet", 2),
                  row(0, "QuoteTweet", 1),
                  row(0, "Follow", 9),
                  row(1, "Displayed", 80),
                  row(1, "Fav", 5),
                ],
                // The last day X has not counted yet comes from its hourly counts.
                hourly_backfill: [
                  { timestamp: day(2), engagement_type: "Displayed", count: 40 },
                  { timestamp: day(1), engagement_type: "Displayed", count: 999 },
                ],
                previous_totals: [row(-3, "Displayed", 250), row(-3, "Reply", 3)],
                legacy_current_follow_metrics: [follows(0, 2, 1)],
                legacy_previous_follow_metrics: [follows(-3, 1, 0), follows(-2, 1, 1)],
              },
            },
          },
        },
      },
    );
    expect([overview.key, overview.accountAnalytics, hasEngineContent(overview)]).toEqual([
      "overview:3",
      {
        kind: "overview",
        days: 3,
        from: "2026-10-27T00:00:00.000Z",
        daily: [
          // X's follows replace the engagement rows' own; a quote counts as a repost.
          { Impressions: 320, Retweets: 3, Follows: 2, Unfollows: 1 },
          { Impressions: 80, Likes: 5 },
          { Impressions: 40 },
        ],
        previous: { Impressions: 250, Replies: 3, Follows: 2, Unfollows: 1 },
        followers: 120,
        verifiedFollowers: 4,
      },
      true,
    ]);
  });

  it("reads X's analytics Content, Video and Audience pages for the range each asked about", () => {
    const viewer = (result: Record<string, unknown>) => ({
      data: { viewer_v2: { user_results: { result: { __typename: "User", ...result } } } },
    });
    const content = renderEngineBatch(
      "contentPageQuery",
      {
        from_time: "2026-10-06T00:00:00.000Z",
        to_time: "2026-11-02T23:59:59.999Z",
        max_results: 1000,
      },
      viewer({
        tweets_results: [
          {
            rest_id: "51",
            result: {
              __typename: "Tweet",
              rest_id: "51",
              details: {
                created_at_ms: Date.UTC(2026, 10, 1, 9),
                full_text: "@sam thanks 🙏 https://t.co/x",
                display_text_range: [5, 13],
              },
              reply_to_results: { rest_id: "50" },
              organic_metrics_total: [
                { metric_type: "Impressions", metric_value: 900 },
                { metric_type: "Likes" },
              ],
            },
          },
        ],
      }),
    );
    expect([content.key, content.accountAnalytics]).toEqual([
      "content:28",
      {
        kind: "content",
        days: 28,
        posts: [
          {
            postId: "51",
            text: "thanks 🙏",
            createdAt: "2026-11-01T09:00:00.000Z",
            reply: true,
            community: false,
            metrics: { Impressions: 900, Likes: 0 },
          },
        ],
      },
    ]);

    // The video overview asks for its 7 days and the 7 before at once; it counts its own.
    const to = Date.UTC(2026, 10, 2, 23, 59, 59, 999);
    const point = (daysBack: number, views: number) => ({
      timestamp: to + 1 - daysBack * 86_400_000,
      metric_values: [{ metric_type: "VideoView", metric_value: views }],
    });
    const video = renderEngineBatch(
      "mediaMetricsQuery",
      { from_timestamp: to + 1 - 14 * 86_400_000, to_timestamp: to },
      viewer({
        media_metrics_time_series_for_publisher: {
          metric_values: [point(9, 1000), point(7, 30), point(1, 12)],
        },
      }),
    );
    expect([video.key, video.accountAnalytics]).toEqual([
      "video:7",
      { kind: "video", days: 7, totals: { VideoView: 42 } },
    ]);

    // Its videos, newest first by the time in their media id; X lists only videos.
    const media = (key: string, total: number) => ({
      result: {
        __typename: "ApiMedia",
        media_key: key,
        video_media_name: `clip ${key}`,
        video_view_count: { __typename: "Count", total },
        media_info: {
          __typename: "ApiVideo",
          duration_millis: 37_000,
          preview_image: { original_img_url: `https://pbs.twimg.com/${key}.jpg` },
        },
        get_media_posts_results: [{ rest_id: "61", result: { __typename: "Tweet" } }],
      },
    });
    const videos = renderEngineBatch(
      "videoListProviderQuery",
      { cursor: null, limit: 30 },
      viewer({
        get_media_filtered: {
          media_results: [
            media("13_1700000000000000000", 5),
            media("3_1800000000000000000", 1),
            media("7_1800000000000000000", 9),
          ],
        },
      }),
    );
    expect([videos.key, videos.accountAnalytics]).toEqual([
      "videos",
      {
        kind: "videos",
        videos: [
          {
            mediaKey: "7_1800000000000000000",
            name: "clip 7_1800000000000000000",
            views: 9,
            durationMs: 37_000,
            previewUrl: "https://pbs.twimg.com/7_1800000000000000000.jpg",
            postId: "61",
            createdAt: "2024-06-10T03:00:17.039Z",
          },
          {
            mediaKey: "13_1700000000000000000",
            name: "clip 13_1700000000000000000",
            views: 5,
            durationMs: 37_000,
            previewUrl: "https://pbs.twimg.com/13_1700000000000000000.jpg",
            postId: "61",
            createdAt: "2023-09-08T04:15:59.129Z",
          },
        ],
      },
    ]);

    const audience = renderEngineBatch(
      "audienceOverviewDataQuery",
      { from_time_incl: Date.UTC(2026, 9, 27), to_time_excl: Date.UTC(2026, 10, 3) - 1 },
      viewer({
        uec_metrics_daily_time_series_count: [
          {
            engagement_type: "Displayed",
            count: 70,
            age: "Age25to34",
            gender: "Female",
            client_app_id: 129032,
          },
        ],
        uec_country_metrics_daily_time_series_count: [
          { engagement_type: "Fav", count: 3, country: "BD" },
        ],
      }),
    );
    expect([audience.key, audience.accountAnalytics]).toEqual([
      "audience:7",
      {
        kind: "audience",
        days: 7,
        rows: [
          {
            type: "Displayed",
            count: 70,
            age: "Age25to34",
            gender: "Female",
            app: "129032",
            country: null,
          },
          { type: "Fav", count: 3, age: null, gender: null, app: null, country: "BD" },
        ],
      },
    ]);
  });

  it("reads a search of Communities by its query: X's Communities, then its Top and Latest posts", () => {
    const banner = (url: string) => ({ media_info: { original_img_url: url } });
    // X's Communities tab, in the shape a live read showed: each one by `rest_id`, with a facepile.
    const found = renderEngineBatch(
      "CommunitiesSearchQuery",
      { query: "makers", cursor: null },
      {
        data: {
          communities_search_slice: {
            items_results: [
              {
                id: "Q1",
                result: {
                  __typename: "Community",
                  id: "Q29tbXVuaXR5OjIx",
                  rest_id: "21",
                  name: "Makers",
                  member_count: 4200,
                  is_nsfw: false,
                  primary_community_topic: { topic_name: "Software" },
                  custom_banner_media: banner("https://pbs.twimg.com/custom.jpg"),
                  default_banner_media: banner("https://pbs.twimg.com/default.png"),
                  members_facepile_results: [
                    {
                      id: "U1",
                      result: {
                        __typename: "User",
                        id: "VXNlcjo3",
                        avatar: { image_url: "https://pbs.twimg.com/face.jpg" },
                      },
                    },
                  ],
                },
              },
              {
                id: "Q2",
                result: {
                  __typename: "Community",
                  id: "Q29tbXVuaXR5OjIw",
                  rest_id: "20",
                  name: "Tools",
                  member_count: 12,
                  default_banner_media: banner("https://pbs.twimg.com/default.png"),
                },
              },
            ],
            slice_info: { next_cursor: "c-next" },
          },
        },
      },
    );
    expect([
      found.key,
      found.communities.map((c) => [c.communityId, c.name, c.members, c.topic, c.bannerUrl]),
      found.users,
    ]).toEqual([
      "makers",
      [
        ["21", "Makers", 4200, "Software", "https://pbs.twimg.com/custom.jpg"],
        ["20", "Tools", 12, null, "https://pbs.twimg.com/default.png"],
      ],
      [],
    ]);
    // X found none: still its answer, which the screen says.
    const none = renderEngineBatch(
      "CommunitiesSearchQuery",
      { query: "zzz", cursor: null },
      { data: { communities_search_slice: { items_results: [], slice_info: {} } } },
    );
    expect([none.key, hasEngineContent(none)]).toEqual(["zzz", true]);

    // Top and Latest: posts from Communities, each labelled with its Community.
    const posts = (op: string, page: string) =>
      renderEngineBatch(
        op,
        { rawQuery: "makers", count: 20 },
        {
          data: {
            search_by_raw_query: {
              [page]: {
                timeline: {
                  instructions: [
                    { type: "TimelineClearCache" },
                    { type: "TimelineTerminateTimeline", direction: "Top" },
                    {
                      type: "TimelineAddEntries",
                      entries: ["62", "61"].map((id) =>
                        item(tweet(id), {
                          type: "TimelineGeneralContext",
                          contextType: "Community",
                          text: "Makers",
                        }),
                      ),
                    },
                  ],
                },
              },
            },
          },
        },
      );
    const top = posts("GlobalCommunitiesPostSearchTimeline", "communities_posts_search_page");
    const latest = posts(
      "GlobalCommunitiesLatestPostSearchTimeline",
      "communities_latest_posts_search_page",
    );
    expect([top.key, top.order, top.posts[0]?.context?.text, latest.key, latest.order]).toEqual([
      "makers",
      ["62", "61"],
      "Makers",
      "makers",
      ["62", "61"],
    ]);
    // No query is no search.
    const blank = renderEngineBatch("CommunitiesSearchQuery", { query: "" }, {});
    expect([blank.key, hasEngineContent(blank)]).toEqual([null, false]);
    expect(hasEngineContent(renderEngineBatch("GlobalCommunitiesPostSearchTimeline", {}, {}))).toBe(
      false,
    );
  });

  it("lists a profile's followers under the person's id in X's order, and passes on X's answer of nobody", () => {
    const page = (entries: ReadonlyArray<unknown>) => ({
      data: {
        user: {
          result: {
            __typename: "User",
            timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } },
          },
        },
      },
    });
    const follower = (id: string, handle: string) => ({
      entryId: `user-${id}`,
      content: {
        entryType: "TimelineTimelineItem",
        itemContent: {
          itemType: "TimelineUser",
          user_results: {
            result: user(id, handle, { relationship_perspectives: { followed_by: true } }),
          },
        },
      },
    });
    const followers = renderEngineBatch(
      "Followers",
      { userId: "5", count: 20 },
      page([
        follower("12", "zed"),
        follower("11", "amy"),
        { entryId: "cursor-bottom-1", content: { cursorType: "Bottom", value: "1369|2117" } },
      ]),
    );
    expect([followers.key, followers.people, followers.bottom]).toEqual([
      "5",
      ["12", "11"],
      "1369|2117",
    ]);
    expect(followers.users.map((u) => u.followsYou)).toEqual([true, true]);
    const none = renderEngineBatch("FollowersYouKnow", { userId: "5", count: 20 }, page([]));
    expect([none.key, none.people, hasEngineContent(none)]).toEqual(["5", [], true]);
    // X's rate limit answers with an error alone: no list, so no answer of nobody.
    const limited = renderEngineBatch(
      "Followers",
      { userId: "5", count: 20 },
      { errors: [{ code: 88, message: "Rate limit exceeded" }] },
    );
    expect([limited.key, hasEngineContent(limited)]).toEqual([null, false]);
  });

  it("reads X's count of followers you know by the profile it asked about, and nothing from an error", () => {
    const url = (id: string) =>
      `https://x.com/i/api/1.1/friends/following/list.json?include_profile_interstitial_type=1&user_id=${id}&count=3`;
    const known = renderKnownFollowers(url("5"), {
      users: [{ id_str: "11", screen_name: "amy" }],
      next_cursor: 0,
      previous_cursor: 0,
      total_count: 75,
    })!;
    expect([known.key, known.knownFollowers, hasEngineContent(known)]).toEqual(["5", 75, true]);
    expect(renderKnownFollowers(url("6"), { users: [], total_count: 0 })?.knownFollowers).toBe(0);
    expect(renderKnownFollowers(url("5"), { errors: [{ code: 88 }] })).toBeNull();
  });
});

describe("renderEngineBatch for live text, edits, threads and people", () => {
  it("places entities in the shown text, reads edits, groups a conversation, and keeps every user", () => {
    const text = "🚀 @Theo ships #buildinpublic for $TSLA fans @theo";
    const live = tweet(
      "2",
      {
        full_text: text,
        entities: {
          user_mentions: [
            { screen_name: "Theo", indices: [2, 7] },
            { screen_name: "theo", indices: [43, 48] },
          ],
          hashtags: [{ text: "buildinpublic", indices: [14, 28] }],
          symbols: [{ text: "TSLA", indices: [33, 38] }],
          urls: [],
        },
      },
      {
        edit_control: {
          edit_control_initial: {
            edit_tweet_ids: ["1", "2"],
            editable_until_msecs: "1793383169000",
            edits_remaining: "4",
          },
        },
      },
    );
    const parent = tweet("1");
    const listed = user("9", "dhh");
    const batch = renderEngineBatch(
      "HomeLatestTimeline",
      {},
      {
        data: {
          entries: [
            {
              entryId: "home-conversation-2",
              content: {
                entryType: "TimelineTimelineModule",
                displayType: "VerticalConversation",
                items: [
                  { item: { itemContent: { tweet_results: { result: parent } } } },
                  { item: { itemContent: { tweet_results: { result: live } } } },
                ],
              },
            },
            {
              content: {
                itemContent: { itemType: "TimelineUser", user_results: { result: listed } },
              },
            },
          ],
        },
      },
    );
    const [first, second] = batch.posts;
    const at = (start: number, end: number) => [text.slice(start, end), [start, end]];
    expect(second!.entities.mentions.map((m) => [m.handle, ...at(...m.indices)])).toEqual([
      ["theo", "@Theo", [3, 8]],
      ["theo", "@theo", [45, 50]],
    ]);
    expect(second!.entities.hashtags.map((h) => text.slice(...h.indices))).toEqual([
      "#buildinpublic",
    ]);
    expect(second!.entities.cashtags.map((c) => text.slice(...c.indices))).toEqual(["$TSLA"]);
    expect([second!.edits, second!.editsRemaining, second!.editableUntil]).toEqual([
      ["1", "2"],
      4,
      "2026-10-30T17:59:29.000Z",
    ]);
    expect([first!.conversation, second!.conversation]).toEqual([
      { id: "home-conversation-2", index: 0, size: 2 },
      { id: "home-conversation-2", index: 1, size: 2 },
    ]);
    // Everyone named is known; only the one X listed is a person on this page.
    expect(batch.users.map((u) => u.handle).sort()).toEqual(["dhh", "theo"]);
    expect(batch.people).toEqual(["9"]);
  });

  it("draws a long post's bold and italic where X's richtext_tags put them in the shown text", () => {
    // X counts in the whole text, "Replying to" handle included; a tag X sent empty is nothing.
    const full = "@theo Ship it today. Then rest.";
    const note = {
      text: full,
      entity_set: { user_mentions: [{ screen_name: "theo", indices: [0, 5] }] },
      richtext: {
        richtext_tags: [
          { from_index: 6, to_index: 13, richtext_types: ["Bold"] },
          { from_index: 11, to_index: 19, richtext_types: ["Italic", "Bold"] },
          { from_index: 21, to_index: 21, richtext_types: ["Bold"] },
        ],
      },
    };
    const reply = tweet(
      "5",
      {
        full_text: full,
        display_text_range: [6, 31],
        entities: { user_mentions: [{ screen_name: "theo", indices: [0, 5] }], urls: [] },
      },
      { note_tweet: { note_tweet_results: { result: note } } },
    );
    const [post] = renderEngineBatch("TweetDetail", {}, { data: [reply] }).posts;
    expect(post!.text).toBe("Ship it today. Then rest.");
    expect(post!.styles!.map((s) => [s.style, post!.text.slice(s.start, s.end)])).toEqual([
      ["Bold", "Ship it"],
      ["Italic", "it today"],
      ["Bold", "it today"],
    ]);
    expect(renderEngineBatch("TweetDetail", {}, { data: [tweet("6")] }).posts[0]!.styles).toBe(
      undefined,
    );
  });
});

describe("renderEngineBatch media and the viewer", () => {
  it("plays a video from its best mp4 with its length, keeps a photo's alt text, and shows a repost as its original", () => {
    const video = tweet("2", {
      extended_entities: {
        media: [
          {
            type: "video",
            media_url_https: "https://pbs.twimg.com/poster.jpg",
            original_info: { width: 1280, height: 720 },
            video_info: {
              duration_millis: 24866,
              variants: [
                { content_type: "application/x-mpegURL", url: "https://video.twimg.com/v.m3u8" },
                {
                  content_type: "video/mp4",
                  bitrate: 832000,
                  url: "https://video.twimg.com/low.mp4",
                },
                {
                  content_type: "video/mp4",
                  bitrate: 2176000,
                  url: "https://video.twimg.com/high.mp4",
                },
              ],
            },
          },
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/p.jpg",
            ext_alt_text: "A cat on a desk",
          },
        ],
      },
    });
    const repost = tweet("3", { retweeted_status_result: { result: video } });
    const [post] = renderEngineBatch("HomeLatestTimeline", {}, { data: [repost] }).posts;
    expect(post!.postId).toBe("2");
    expect(post!.media).toEqual([
      {
        kind: "video",
        url: "https://pbs.twimg.com/poster.jpg",
        videoUrl: "https://video.twimg.com/high.mp4",
        width: 1280,
        height: 720,
        durationMs: 24866,
        altText: null,
      },
      {
        kind: "photo",
        url: "https://pbs.twimg.com/p.jpg",
        videoUrl: null,
        width: 0,
        height: 0,
        durationMs: null,
        altText: "A cat on a desk",
      },
    ]);
  });

  it("names the signed-in account from X's Viewer call", () => {
    const batch = renderEngineBatch(
      "Viewer",
      {},
      { data: { viewer: { user_results: { result: user("7", "siamships") } } } },
    );
    expect(batch.viewer).toEqual({
      userId: "7",
      handle: "siamships",
      name: "SIAMSHIPS",
      avatarUrl: "https://pbs.twimg.com/profile_images/7/a_normal.jpg",
    });
    expect(renderEngineBatch("HomeTimeline", {}, {}).viewer).toBeNull();
  });
});

describe("renderEngineBatch entry order, badges and labels", () => {
  it("lists X's entries in order, a pinned one first and a repost as its original", () => {
    const pinned = tweet("1");
    const quoting = tweet(
      "2",
      { quoted_status_id_str: "1" },
      { quoted_status_result: { result: pinned } },
    );
    const repost = tweet("4", { retweeted_status_result: { result: tweet("3") } });
    const entry = (t: unknown) => ({
      content: { itemContent: { itemType: "TimelineTweet", tweet_results: { result: t } } },
    });
    const batch = renderEngineBatch(
      "UserOriginalsTimeline",
      {},
      {
        data: {
          instructions: [
            { type: "TimelinePinEntry", entry: entry(pinned) },
            { entries: [entry(quoting), entry(repost)] },
          ],
        },
      },
    );
    expect(batch.order).toEqual(["1", "2", "3"]);
  });

  it("lists X's Who to follow where it sits among the posts, its people in X's order", () => {
    // X's module entry as HomeTimeline sends it (synthetic: no recording holds one yet).
    const suggested = (id: string, handle: string) => ({
      entryId: `who-to-follow-1849-user-${id}`,
      item: {
        itemContent: {
          itemType: "TimelineUser",
          userDisplayType: "User",
          user_results: { result: user(id, handle) },
        },
      },
    });
    const batch = renderEngineBatch(
      "HomeTimeline",
      {},
      {
        data: {
          home: {
            home_timeline_urt: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    { entryId: "tweet-1", ...item(tweet("1")) },
                    {
                      entryId: "who-to-follow-1849",
                      content: {
                        entryType: "TimelineTimelineModule",
                        displayType: "Vertical",
                        header: { displayType: "Classic", text: "Who to follow" },
                        footer: { displayType: "Classic", text: "Show more" },
                        items: [suggested("12", "zed"), suggested("11", "amy")],
                      },
                    },
                    { entryId: "tweet-2", ...item(tweet("2")) },
                  ],
                },
              ],
            },
          },
        },
      },
    );
    expect(batch.order).toEqual(["1", "who-to-follow-1849", "2"]);
    expect(batch.modules).toEqual([
      { id: "who-to-follow-1849", title: "Who to follow", userIds: ["12", "11"] },
    ]);
    // Drawn once, as the module: not also as a page's titled box of people.
    expect(batch.sections).toEqual([]);
  });

  it("reads Explore's For you in X's order: news, trends, Who to follow, Posts For You, then paged posts", () => {
    // X's ExplorePage as x.com/explore sent it in November 2026 (synthetic values).
    const trend = (name: string, context: string) => ({
      itemType: "TimelineTrend",
      name,
      trend_metadata: { domain_context: context },
      trend_url: { url: `twitter://search/?query=${name}` },
    });
    const module = (entryId: string, header: string, items: ReadonlyArray<unknown>) => ({
      entryId,
      content: {
        entryType: "TimelineTimelineModule",
        displayType: "Vertical",
        header: { displayType: "Classic", text: header },
        items: items.map((itemContent, i) => ({
          entryId: `${entryId}-${i}`,
          item: { itemContent },
        })),
      },
    });
    const cursors = (top: string, bottom: string) =>
      (["Top", "Bottom"] as const).map((cursorType) => ({
        entryId: `cursor-${cursorType.toLowerCase()}-1`,
        content: {
          entryType: "TimelineTimelineCursor",
          cursorType,
          value: cursorType === "Top" ? top : bottom,
        },
      }));
    const page = (entries: ReadonlyArray<unknown>) => ({
      data: {
        explore_page: {
          body: {
            initialTimeline: {
              id: "for_you",
              labelText: "Explore",
              timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries }] } },
            },
            timelines: [
              { id: "for_you", labelText: "Explore", timeline: { id: "VF9" } },
              { id: "trending", labelText: "Trending", timeline: { id: "VTR" } },
            ],
          },
        },
      },
    });
    const tweetItem = (id: string) => item(tweet(id)).content.itemContent;
    const first = renderEngineBatch(
      "ExplorePage",
      { cursor: "" },
      page([
        module("stories-9", "Today's News", [trend("Rockets launch", "2 hours ago · News")]),
        { entryId: "trend-Halloween", content: { itemContent: trend("Halloween", "Trending") } },
        module("who-to-follow-8", "Who to follow", [
          { itemType: "TimelineUser", user_results: { result: user("12", "zed") } },
        ]),
        module("tweet-1", "Posts For You", [tweetItem("1"), tweetItem("2")]),
        ...cursors("t1", "b1"),
      ]),
    );
    expect(first.trends.map((t) => [t.name, t.group])).toEqual([
      ["Rockets launch", "Today's News"],
      ["Halloween", null],
    ]);
    expect(first.order).toEqual(["who-to-follow-8", "tweet-1", "1", "2"]);
    expect(first.modules).toEqual([
      { id: "who-to-follow-8", title: "Who to follow", userIds: ["12"] },
      { id: "tweet-1", title: "Posts For You", userIds: [] },
    ]);
    expect([first.key, first.cursor, first.top, first.bottom]).toEqual(["VF9", null, "t1", "b1"]);
    // Scrolling asks with the bottom cursor and gets plain posts, keyed to the same tab.
    const next = renderEngineBatch(
      "ExplorePage",
      { cursor: "b1" },
      page([{ entryId: "tweet-3", ...item(tweet("3")) }, ...cursors("t2", "b2")]),
    );
    expect([next.key, next.cursor, next.order, next.modules]).toEqual(["VF9", "b1", ["3"], []]);
    // A thread's Discover more is a titled box of posts too, but not one Explore draws.
    expect(
      renderEngineBatch(
        "TweetDetail",
        {},
        page([module("related-1", "Discover more", [tweetItem("4")])]),
      ).modules,
    ).toEqual([]);
  });

  it("reads the badge kind, avatar shape, organisation badge and the Made with AI label", () => {
    const org = user("8", "heyglif", {
      verification: { verified_type: "Business" },
      profile_image_shape: "Square",
      affiliates_highlighted_label: {
        label: {
          description: "X",
          badge: { url: "https://pbs.twimg.com/b.jpg" },
          url: { url: "https://twitter.com/X" },
        },
      },
    });
    const made = tweet(
      "5",
      {},
      {
        core: { user_results: { result: org } },
        content_disclosure: { ai_generated_disclosure: { has_ai_generated_media: true } },
      },
    );
    const batch = renderEngineBatch("SearchTimeline", {}, { data: [made] });
    expect(batch.posts[0]!.aiGenerated).toBe(true);
    expect(batch.users.find((u) => u.handle === "heyglif")).toMatchObject({
      verifiedType: "Business",
      avatarShape: "Square",
      affiliate: {
        name: "X",
        badgeUrl: "https://pbs.twimg.com/b.jpg",
        url: "https://twitter.com/X",
      },
    });
  });

  it("reads X's own translation, trimmed like the text, with its links placed", () => {
    const es = tweet(
      "6",
      {
        full_text: "Mira esto https://t.co/a https://t.co/m",
        entities: {
          urls: [{ url: "https://t.co/a", expanded_url: "https://a.es", display_url: "a.es" }],
        },
        extended_entities: {
          media: [
            {
              url: "https://t.co/m",
              type: "photo",
              media_url_https: "https://pbs.twimg.com/m.jpg",
            },
          ],
        },
      },
      {
        grok_translated_post_with_availability: {
          is_available: true,
          data: {
            source_language: "es",
            destination_language: "en",
            translation: "Look at this https://t.co/a https://t.co/m",
            entities: {
              urls: [{ url: "https://t.co/a", expanded_url: "https://a.es", display_url: "a.es" }],
            },
          },
        },
      },
    );
    const none = tweet(
      "7",
      {},
      { grok_translated_post_with_availability: { is_available: false } },
    );
    const [translated, plain] = renderEngineBatch("SearchTimeline", {}, { data: [es, none] }).posts;
    expect(translated!.translation).toEqual({
      text: "Look at this https://t.co/a",
      from: "es",
      entities: {
        urls: [
          { url: "https://t.co/a", expanded: "https://a.es", display: "a.es", indices: [13, 27] },
        ],
        mentions: [],
        hashtags: [],
        cashtags: [],
      },
    });
    expect(plain!.translation).toBeNull();
  });
});

describe("renderEngineBatch GIF search", () => {
  // X's GifSearch item, as read live on 2026-11-02 (gif_search_slice), with made-up values.
  const image = (n: number) => ({
    url: `https://media1.giphy.com/media/g${n}/200_d.gif`,
    still_image_url: `https://media1.giphy.com/media/g${n}/200_d_s.gif`,
    width: 200,
    height: 150,
  });
  const gif = (n: number, alt?: string) => ({
    id: `giphy_g${n}`,
    provider: { id: "giphy", display_name: "GIPHY" },
    preview_image: image(n),
    full_image: image(n),
    thumbnail_images: [image(n)],
    ...(alt === undefined ? {} : { alt_text: alt }),
  });
  const slice = (items: ReadonlyArray<unknown>, next?: string) => ({
    data: {
      gif_search_slice: { items, slice_info: next === undefined ? {} : { next_cursor: next } },
    },
  });

  it("lists X's tiles in X's order under the query, with the cursor of X's next page", () => {
    const first = renderEngineBatch(
      "GifSearch",
      { query: "cat" },
      slice([gif(1, "Cat Jump"), { id: "giphy_none" }, gif(2)], "go50c50"),
    );
    expect([first.key, first.cursor, first.bottom]).toEqual(["gifs:cat", null, "go50c50"]);
    expect(first.gifs).toEqual([
      {
        id: "giphy_g1",
        altText: "Cat Jump",
        url: "https://media1.giphy.com/media/g1/200_d.gif",
        stillUrl: "https://media1.giphy.com/media/g1/200_d_s.gif",
        width: 200,
        height: 150,
        provider: "GIPHY",
      },
      expect.objectContaining({ id: "giphy_g2", altText: null }),
    ]);
    const next = renderEngineBatch(
      "GifSearch",
      { query: "cat", cursor: "go50c50" },
      slice([gif(3)]),
    );
    expect([next.cursor, next.bottom, next.gifs?.map((g) => g.id)]).toEqual([
      "go50c50",
      null,
      ["giphy_g3"],
    ]);
  });

  it("passes on a search X found nothing for, and no GIFs on any other call", () => {
    const none = renderEngineBatch("GifSearch", {}, slice([]));
    expect([none.key, none.gifs, hasEngineContent(none)]).toEqual(["gifs:", [], true]);
    expect(renderEngineBatch("HomeTimeline", {}, {}).gifs).toBeUndefined();
  });
});

describe("renderEngineBatch for a profile's Subs", () => {
  it("names a creator who offers Subscriptions, and reads X's subscribe prompt in place of posts", () => {
    const header = (eligible?: boolean) =>
      renderEngineBatch(
        "UserByScreenName",
        { screen_name: "maker" },
        {
          data: {
            user: {
              result: user(
                "50",
                "maker",
                eligible === undefined ? {} : { super_follow_eligible: eligible },
              ),
            },
          },
        },
      ).users[0]!;
    expect([
      header(true).offersSubscriptions,
      header(false).offersSubscriptions,
      "offersSubscriptions" in header(),
    ]).toEqual([true, false, false]);

    // X's answer for someone who does not subscribe, in the shape a live read showed.
    const subs = renderEngineBatch(
      "UserSuperFollowTweets",
      { userId: "50", count: 20, includePromotedContent: true, withVoice: true },
      {
        data: {
          user: {
            result: {
              __typename: "User",
              timeline: {
                timeline: {
                  instructions: [
                    { type: "TimelineClearCache" },
                    {
                      type: "TimelineAddEntries",
                      entries: [
                        {
                          entryId: "messageprompt-50",
                          sortIndex: "50",
                          content: {
                            __typename: "TimelineTimelineItem",
                            entryType: "TimelineTimelineItem",
                            clientEventInfo: { component: "subscribe_prompt", element: "message" },
                            itemContent: {
                              __typename: "TimelineMessagePrompt",
                              itemType: "TimelineMessagePrompt",
                              content: {
                                contentType: "TimelineInlinePrompt",
                                headerText: "Unlock more with Subscriptions",
                                bodyText:
                                  // X ends its body with a tab, which drawn text drops.
                                  "@maker has shared 12 Subscriber-only posts. Subscribe to see their exclusive posts and bonus content.\t",
                                primaryButtonAction: {
                                  text: "Subscribe",
                                  action: {
                                    dismissOnClick: false,
                                    url: "https://twitter.com/maker/superfollows/subscribe",
                                  },
                                },
                              },
                            },
                          },
                        },
                        {
                          entryId: "cursor-top-50",
                          sortIndex: "50",
                          content: {
                            entryType: "TimelineTimelineCursor",
                            __typename: "TimelineTimelineCursor",
                            cursorType: "Top",
                            value: "c-Top",
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    );
    expect([subs.key, subs.order, subs.top]).toEqual(["50", [], "c-Top"]);
    expect(subs.prompt).toEqual({
      header: "Unlock more with Subscriptions",
      body: "@maker has shared 12 Subscriber-only posts. Subscribe to see their exclusive posts and bonus content.",
      button: { text: "Subscribe", url: "https://x.com/maker/superfollows/subscribe" },
    });
    // A prompt alone is something to draw.
    expect(hasEngineContent(subs)).toBe(true);
  });
});

describe("renderEngineBatch for X's sports pages", () => {
  // X's game shapes, as a live read of x.com showed them; the values are made up.
  const side = (abbreviation: string, points: number) => ({
    abbreviation,
    name: `${abbreviation} name`,
    points,
    team: { id: "VGVhbTox", rest_id: "706000000000000001" },
  });
  const card = (id: string, status: string, away: [string, number], home: [string, number]) => ({
    game: {
      __typename: "SportsProfileNbaGame",
      nba_game: {
        id: "R2FtZTox",
        rest_id: id,
        live: {
          away_points: away[1],
          home_points: home[1],
          clock_running: false,
          halftime: false,
          period_type: "NBA_PERIOD_TYPE_UNSPECIFIED",
          status,
        },
        summary: {
          away: side(...away),
          home: side(...home),
          period_type: "NBA_PERIOD_TYPE_UNSPECIFIED",
          scheduled_ms: "1792962000000",
          status,
          went_to_overtime: false,
        },
      },
    },
    start_time: "1792962000000",
  });
  const play = (sequence: string, kind: string, description: string) => ({
    away_points: 82,
    home_points: 104,
    clock: "00:00",
    description,
    id: "UGxheTox",
    kind,
    participants: [],
    scoring: false,
    sequence,
    team: { id: "VGVhbTox", rest_id: "706000000000000001" },
  });

  it("reads a team's schedule from its profile, and nothing for an account X gives none", () => {
    const schedule = renderEngineBatch(
      "UserSportsProfile",
      { rest_id: "20000001", start_time: "1792900200000", end_time: "1794801300000" },
      {
        data: {
          user_results: {
            id: "VXNlcjox",
            rest_id: "20000001",
            result: {
              __typename: "User",
              rest_id: "20000001",
              sports_profile: {
                league: "NBA",
                season_schedule: {
                  start_time: "1792900200000",
                  end_time: "1794801300000",
                  games: [
                    card("31", "COMPLETED", ["LAL", 132], ["UTA", 123]),
                    card("32", "SCHEDULED", ["MIA", 0], ["LAL", 0]),
                  ],
                },
              },
            },
          },
        },
      },
    );
    expect(schedule.key).toBe("20000001");
    expect(hasEngineContent(schedule)).toBe(true);
    expect(schedule.games).toEqual([
      {
        gameId: "31",
        status: "COMPLETED",
        startsAt: "2026-10-25T21:00:00.000Z",
        away: { abbreviation: "LAL", name: "LAL name", points: 132, timeouts: null, bonus: null },
        home: { abbreviation: "UTA", name: "UTA name", points: 123, timeouts: null, bonus: null },
        period: null,
        periodType: "NBA_PERIOD_TYPE_UNSPECIFIED",
        clock: null,
        halftime: false,
        lastPlay: null,
      },
      expect.objectContaining({ gameId: "32", status: "SCHEDULED" }),
    ]);
    // A football club: X answers with the user alone.
    const none = renderEngineBatch(
      "UserSportsProfile",
      { rest_id: "20000002" },
      { data: { user_results: { result: { __typename: "User", rest_id: "20000002" } } } },
    );
    expect(none.games).toBeUndefined();
    expect(hasEngineContent(none)).toBe(false);
  });

  it("reads a game's clock, timeouts, bonus and newest play, and the day's scoreboard in X's order", () => {
    const game = {
      id: "R2FtZTox",
      rest_id: "41",
      live: {
        away_bonus: true,
        away_points: 82,
        away_timeouts: 3,
        clock: "00:00",
        clock_observed_ms: "1793591485728",
        clock_running: false,
        halftime: false,
        home_bonus: false,
        home_points: 104,
        home_timeouts: 5,
        period_type: "QUARTER",
        quarter: 3,
        status: "IN_PROGRESS",
      },
      plays: {
        latest_sequence: "1793587254024",
        periods: [
          { period: 3, period_type: "QUARTER", plays: [play("1793585521371", "SHOT", "Older")] },
          {
            period: 3,
            period_type: "QUARTER",
            plays: [
              play("1793587254024", "REBOUND", "Raptors offensive rebound"),
              play("1793587254023", "SHOT", "Missed three"),
            ],
          },
        ],
      },
      summary: {
        away: side("TOR", 82),
        home: side("LAL", 104),
        period_type: "QUARTER",
        quarter: 3,
        scheduled_ms: "1793584800000",
        status: "IN_PROGRESS",
      },
    };
    const hydrate = renderEngineBatch(
      "NBAGameHydrate",
      { rest_id: "41" },
      { data: { nba_game: game } },
    );
    expect(hydrate.key).toBe("41");
    expect(hydrate.games).toEqual([
      {
        gameId: "41",
        status: "IN_PROGRESS",
        startsAt: "2026-11-02T02:00:00.000Z",
        away: { abbreviation: "TOR", name: "TOR name", points: 82, timeouts: 3, bonus: true },
        home: { abbreviation: "LAL", name: "LAL name", points: 104, timeouts: 5, bonus: false },
        period: 3,
        periodType: "QUARTER",
        clock: "00:00",
        halftime: false,
        lastPlay: { kind: "REBOUND", description: "Raptors offensive rebound" },
      },
    ]);
    // X's re-poll while live: the score alone, no new plays.
    const poll = renderEngineBatch(
      "NBALiveGame",
      { rest_id: "41", since_sequence: "1793587254024" },
      {
        data: {
          nba_game: {
            rest_id: "41",
            summary: { away: { points: 84 }, home: { points: 104 }, status: "IN_PROGRESS" },
          },
        },
      },
    );
    expect(poll.games).toEqual([
      expect.objectContaining({
        away: { abbreviation: null, name: null, points: 84, timeouts: null, bonus: null },
        lastPlay: null,
      }),
    ]);
    const day = renderEngineBatch(
      "NBASchedule",
      { start_ms: "1793520000000", end_ms: "1793606400000", limit: 500 },
      {
        data: {
          nba_schedule: {
            games: [
              { ...game, rest_id: "42", summary: { ...game.summary, away: side("BOS", 108) } },
              game,
            ],
          },
        },
      },
    );
    expect(day.games?.map((g) => [g.gameId, g.away.abbreviation])).toEqual([
      ["42", "BOS"],
      ["41", "TOR"],
    ]);
  });

  it("keys a game's Top and Latest posts by the game", () => {
    const entry = (id: string) => ({
      entryId: `tweet-${id}`,
      content: {
        entryType: "TimelineTimelineItem",
        itemContent: { itemType: "TimelineTweet", tweet_results: { result: tweet(id) } },
      },
    });
    const latest = renderEngineBatch(
      "SportsGameLatestTimeline",
      { gameId: "41", count: 20 },
      {
        data: {
          sports_timelines: {
            latest: {
              id: "U3BvcnRzOjE=",
              timeline: {
                instructions: [{ type: "TimelineAddEntries", entries: [entry("62"), entry("61")] }],
              },
            },
          },
        },
      },
    );
    expect([latest.key, latest.order]).toEqual(["41", ["62", "61"]]);
    expect(renderEngineBatch("SportsGameTopTimeline", { gameId: "41" }, {}).key).toBe("41");
  });
});

describe("renderEngineBatch for bookmark folders", () => {
  // X's own operations and answers (bundle.BookmarkFolders), with made-up ids and names.
  const folder = (id: string, name: string, image?: string) => ({
    id,
    name,
    ...(image === undefined ? {} : { media: { media_info: { original_img_url: image } } }),
  });

  it("reads X's folders, a folder's posts by the folder, and what X's folder dialogs and rows did", () => {
    const slice = renderEngineBatch(
      "BookmarkFoldersSlice",
      {},
      {
        data: {
          viewer: {
            user_results: {
              result: {
                __typename: "User",
                bookmark_collections_slice: {
                  items: [
                    folder("801", "Reading", "https://pbs.twimg.com/media/a.jpg"),
                    { id: "none" },
                    folder("802", "Launch ideas"),
                  ],
                  slice_info: {},
                },
              },
            },
          },
        },
      },
    );
    expect([slice.bookmarkFolders, hasEngineContent(slice)]).toEqual([
      {
        kind: "list",
        folders: [
          { folderId: "801", name: "Reading", imageUrl: "https://pbs.twimg.com/media/a.jpg" },
          { folderId: "802", name: "Launch ideas", imageUrl: null },
        ],
      },
      true,
    ]);

    // A folder X answered with no posts still reaches its screen, which says it is empty.
    const empty = renderEngineBatch(
      "BookmarkFolderTimeline",
      { bookmark_collection_id: "802", includePromotedContent: true },
      { data: { bookmark_collection_timeline: { timeline: { instructions: [] } } } },
    );
    expect([empty.key, hasEngineContent(empty)]).toEqual(["802", true]);
    // An error alone (X's rate limit) is no answer: the screen offers Load again, not "empty".
    const limited = renderEngineBatch(
      "BookmarkFolderTimeline",
      { bookmark_collection_id: "802", includePromotedContent: true },
      { errors: [{ code: 88, message: "Rate limit exceeded" }] },
    );
    expect([limited.key, hasEngineContent(limited)]).toEqual([null, false]);

    const did = (op: string, variables: Record<string, unknown>, data: Record<string, unknown>) =>
      renderEngineBatch(op, variables, { data }).bookmarkFolders;
    expect(
      did(
        "createBookmarkFolder",
        { name: "Recipes" },
        {
          bookmark_collection_create: { id: "803", name: "Recipes" },
        },
      ),
    ).toEqual({ kind: "saved", folder: { folderId: "803", name: "Recipes", imageUrl: null } });
    // X files a renamed folder under the name it asked for, and a failed rename changes nothing.
    expect(
      did(
        "EditBookmarkFolder",
        { bookmark_collection_id: "801", name: "To read" },
        {
          bookmark_collection_update: { id: "801", name: "Reading" },
        },
      ),
    ).toEqual({ kind: "saved", folder: { folderId: "801", name: "To read", imageUrl: null } });
    expect(
      did("EditBookmarkFolder", { bookmark_collection_id: "801", name: "To read" }, {}),
    ).toBeUndefined();
    expect(
      did(
        "DeleteBookmarkFolder",
        { bookmark_collection_id: "802" },
        { bookmark_collection_delete: "Done" },
      ),
    ).toEqual({ kind: "deleted", folderId: "802" });
    const post = { bookmark_collection_id: "801", tweet_id: "77" };
    expect([
      did("bookmarkTweetToFolder", post, { bookmark_collection_tweet_put: "Done" }),
      did("RemoveTweetFromBookmarkFolder", post, { bookmark_collection_tweet_delete: "Done" }),
    ]).toEqual([
      { kind: "post", folderId: "801", postId: "77", added: true },
      { kind: "post", folderId: "801", postId: "77", added: false },
    ]);
    // An error (no "Done") did nothing.
    expect(did("DeleteBookmarkFolder", { bookmark_collection_id: "802" }, {})).toBeUndefined();
  });

  it("passes on Bookmarks X answered, even with no posts, and nothing from an error alone", () => {
    const none = renderEngineBatch(
      "Bookmarks",
      { count: 20, includePromotedContent: true },
      { data: { bookmark_timeline_v2: { timeline: { instructions: [] } } } },
    );
    expect([none.key, hasEngineContent(none)]).toEqual(["bookmarks", true]);
    const limited = renderEngineBatch("Bookmarks", { count: 20 }, { errors: [{ code: 88 }] });
    expect([limited.key, hasEngineContent(limited)]).toEqual([null, false]);
  });

  it("reads the features X's claims say the account holds, and nothing from an answer without them", () => {
    const claims = renderEngineBatch(
      "GetUserClaims",
      {},
      {
        data: {
          viewer_v2: {
            claims: [
              {
                rest_id: "premium-basic",
                origin: "Commerce",
                resources: [
                  { rest_id: "client_feature_switch/subscriptions_feature_1002/true" },
                  { rest_id: "client_feature_switch/subscriptions_feature_1003/false" },
                  { rest_id: "subscription/premium-basic" },
                ],
              },
            ],
          },
        },
      },
    );
    expect([claims.claims, hasEngineContent(claims)]).toEqual([
      ["subscriptions_feature_1002"],
      true,
    ]);
    const none = renderEngineBatch("GetUserClaims", {}, { data: { viewer_v2: { claims: [] } } });
    expect(none.claims).toEqual([]);
    const error = renderEngineBatch("GetUserClaims", {}, { errors: [{ code: 88 }] });
    expect([error.claims, hasEngineContent(error)]).toEqual([undefined, false]);
  });
});

describe("renderEngineBatch for X's Radar", () => {
  // X's Radar answers in its Relay shape (ondemand.Insights): the user's rules under viewer_v2.
  const viewer = (fields: Record<string, unknown>) => ({
    data: {
      viewer_v2: {
        user_results: { result: { __typename: "User", ...fields, id: "VXNlcjox" }, id: "VXNlcjox" },
      },
    },
  });
  const rule = (
    id: string,
    core: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    rest_id: id,
    core: {
      title: "",
      tags: null,
      advanced_query: null,
      created_at: "2026-10-28T09:00:00.000Z",
      updated_at: "2026-10-28T09:00:00.000Z",
      notifications_enabled: false,
      ...core,
    },
    id: btoa(`InsightRule:${id}`),
    ...extra,
  });

  it("reads the queries in X's order, how many X allows, and a query's days, one X still counts as unknown", () => {
    const list = renderEngineBatch(
      "insightsListContextQuery",
      { previewsEnabled: true },
      viewer({
        insight_rules: {
          items: [
            rule("1801", { title: "Bitcoin", advanced_query: "bitcoin min_faves:50" }),
            // X's older queries name tags, which its page searches joined by OR.
            rule(
              "1802",
              { tags: '["$GOOGL","$AAPL"]', updated_at: "2026-11-01T09:00:00.000Z" },
              {
                preview: {
                  counts: [
                    { start_time: 1_793_491_200, count: 40 },
                    { start_time: 1_793_577_600, count: 12 },
                  ],
                },
              },
            ),
            rule("bad", { title: "Not X's id" }),
          ],
        },
      }),
    );
    const config = renderEngineBatch(
      "insightsConfigQuery",
      {},
      viewer({
        insights_config: {
          __typename: "InsightsConfigSuccess",
          saved_query_limit: 3,
          time_range_limit_days: 3,
        },
      }),
    );
    const counts = renderEngineBatch(
      "usePostCountQuery",
      { id: "1801", granularity: "Day", from_time: 1_793_404_800, to_time: 1_793_664_000 },
      viewer({
        insight_rule_by_id: {
          matched_post_counts: {
            __typename: "InsightsMatchedPostCountsSuccess",
            counts: [
              { count: 9, start_time: 1_793_404_800 },
              { count: 7, start_time: 1_793_491_200 },
              { count: 30, start_time: 1_793_577_600 },
            ],
            has_incomplete_counts: true,
            oldest_complete_count: 1_793_491_200,
            total: 46,
          },
          id: "SW5zaWdodFJ1bGU6MTgwMQ==",
        },
      }),
    );
    const empty = renderEngineBatch(
      "insightsListContextQuery",
      { previewsEnabled: false },
      viewer({ insight_rules: { items: [] } }),
    );
    expect([list.key, list.radarQueries]).toEqual([
      "radar",
      [
        {
          id: "1802",
          title: "",
          query: "$GOOGL OR $AAPL",
          createdAt: "2026-10-28T09:00:00.000Z",
          preview: [
            { at: "2026-11-01T00:00:00.000Z", count: 40 },
            { at: "2026-11-02T00:00:00.000Z", count: 12 },
          ],
        },
        {
          id: "1801",
          title: "Bitcoin",
          query: "bitcoin min_faves:50",
          createdAt: "2026-10-28T09:00:00.000Z",
          preview: [],
        },
      ],
    ]);
    expect([config.radarLimit, counts.key, counts.radarCounts]).toEqual([
      3,
      "1801",
      [
        { at: "2026-10-31T00:00:00.000Z", count: null },
        { at: "2026-11-01T00:00:00.000Z", count: 7 },
        { at: "2026-11-02T00:00:00.000Z", count: 30 },
      ],
    ]);
    // No queries yet still reaches the screen, which offers X's form.
    expect([empty.radarQueries, hasEngineContent(empty)]).toEqual([[], true]);
    // X's answer to the user's delete names the query gone; a failure names none.
    const deleted = (__typename: string) =>
      renderEngineBatch(
        "deleteInsightButtonMutation",
        { id: "1801" },
        {
          data: {
            delete_insight_rule_v2: {
              __typename,
              result: { rest_id: "1801", id: "SW5zaWdodFJ1bGU6MTgwMQ==" },
            },
          },
        },
      );
    const [done, failed] = [deleted("InsightRuleMutationSuccess"), deleted("InsightRuleFailure")];
    expect([done.radarDeleted, hasEngineContent(failed)]).toEqual(["1801", false]);
  });

  it("reads a query's posts in X's newer post shape, keyed by the query and tab without X's range", () => {
    const post = {
      __typename: "Tweet",
      rest_id: "1900",
      core: {
        user_results: {
          result: {
            __typename: "User",
            rest_id: "77",
            core: { name: "Barchart", screen_name: "Barchart" },
            avatar: { image_url: "https://pbs.twimg.com/profile_images/77/b_normal.jpg" },
            verification: { verified_type: "Business" },
            is_blue_verified: true,
            affiliates_highlighted_label: {},
            id: "VXNlcjo3Nw==",
          },
          id: "VXNlcjo3Nw==",
        },
      },
      details: {
        display_text_range: [0, 54],
        full_text: "$GOOGL fell below its 50-day &amp; @nvidia https://t.co/x",
        created_at_ms: 1_793_536_000_000,
        hashtag_entities: [],
        cashtag_entities: [{ indices: [0, 6], text: "GOOGL" }],
        smarttags: [],
      },
      legacy: { entities: { timestamps: [] } },
      url_entities: [
        {
          display_url: "barchart.com/x",
          expanded_url: "https://barchart.com/x",
          indices: [43, 66],
          url: "https://t.co/x",
        },
      ],
      mention_entities: [
        { id_str: "88", indices: [35, 42], is_unmentioned: false, screen_name: "nvidia" },
      ],
      counts: {
        reply_count: 2,
        favorite_count: 30,
        quote_count: 1,
        retweet_count: 4,
        bookmark_count: 5,
      },
      views: { count: "4512" },
      id: "VHdlZXQ6MTkwMA==",
    };
    const body = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  __typename: "TimelineAddEntries",
                  entries: [
                    {
                      content: {
                        __typename: "TimelineTimelineItem",
                        content: {
                          __typename: "TimelineTweet",
                          tweet_results: { rest_id: "1900", result: post },
                        },
                      },
                    },
                    {
                      content: {
                        __typename: "TimelineTimelineCursor",
                        value: "DAADDAAB",
                        cursor_type: "Bottom",
                      },
                    },
                  ],
                },
              ],
            },
          },
          id: "U2VhcmNoUXVlcnk6",
        },
      },
    };
    const top = renderEngineBatch(
      "postListQuery",
      { cursor: null, product: "Top", query: "$GOOGL (buy OR sell) -is:retweet since:2026-10-27" },
      body,
    );
    expect([top.key, top.posts.length, hasEngineContent(top)]).toEqual([
      "radar:Top:$GOOGL (buy OR sell)",
      1,
      true,
    ]);
    expect(top.posts[0]).toMatchObject({
      postId: "1900",
      author: { userId: "77", handle: "barchart", name: "Barchart", verified: true },
      text: "$GOOGL fell below its 50-day & @nvidia https://t.co/x",
      createdAt: "2026-11-01T12:26:40.000Z",
      hasLink: true,
      metrics: { views: 4512, likes: 30, reposts: 4, replies: 2, quotes: 1, bookmarks: 5 },
      avatarUrl: "https://pbs.twimg.com/profile_images/77/b_normal.jpg",
      entities: {
        urls: [
          {
            url: "https://t.co/x",
            expanded: "https://barchart.com/x",
            display: "barchart.com/x",
            indices: [39, 53],
          },
        ],
        mentions: [{ handle: "nvidia", indices: [31, 38] }],
        cashtags: [{ tag: "GOOGL", indices: [0, 6] }],
      },
    });
    // Latest is its own list; a range ending at until: is still the same query.
    expect(
      renderEngineBatch(
        "postListQuery",
        {
          cursor: null,
          product: "Latest",
          query: "$GOOGL (buy OR sell) -is:retweet since:2026-10-27 until:2026-10-30",
        },
        body,
      ).key,
    ).toBe("radar:Latest:$GOOGL (buy OR sell)");
  });
});

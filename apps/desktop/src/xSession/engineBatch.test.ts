import { describe, expect, it } from "@effect/vitest";

import { renderEngineBatch, requestVariables } from "./engineBatch.ts";
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

  it("lists a Community's moderators from its About, not the faces beside its member count", () => {
    const people = (entryId: string, ids: ReadonlyArray<string>) => ({
      entryId,
      content: {
        entryType: "TimelineTimelineModule",
        displayType: "Vertical",
        items: ids.map((id) => ({
          item: {
            itemContent: { itemType: "TimelineUser", user_results: { result: user(id, `u${id}`) } },
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
              about_timeline: {
                timeline: {
                  instructions: [
                    {
                      type: "TimelineAddEntries",
                      entries: [
                        people("communityMembers-1", ["3", "4"]),
                        people("communityModerators-1", ["5", "6"]),
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
    expect(about.people).toEqual(["5", "6"]);
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

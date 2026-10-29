import { expect, test } from "vite-plus/test";

import { normalizeGraphqlResponse } from "./normalizeGraphql.ts";

/**
 * A HomeTimeline response carrying 100 posts, deterministic, in the shapes normalizeGraphql.test.ts
 * reads plus the fields X sends beside them (the user's whole legacy profile, entities, media
 * sizes, edit control, client event info): the walk visits every one of them. 50 plain entries, 8
 * reposts and 10 quotes (each carrying its original), 4 ads and 5 reply threads of two.
 */
const user = (i: number) => ({
  __typename: "User",
  id: btoa(`User:${4_419_639 + i}`),
  rest_id: String(4_419_639 + i),
  affiliates_highlighted_label: {},
  has_graduated_access: true,
  is_blue_verified: i % 5 === 0,
  profile_image_shape: "Circle",
  core: {
    created_at: "Tue Jun 02 20:12:29 +0000 2009",
    name: `Builder ${i}`,
    screen_name: `builder_${i}`,
  },
  avatar: { image_url: `https://pbs.twimg.com/profile_images/${1_700_000 + i}/a_normal.jpg` },
  dm_permissions: { can_dm: i % 3 === 0 },
  location: { location: "San Francisco, CA" },
  privacy: { protected: false },
  relationship_perspectives: { following: i % 2 === 0 },
  verification: { verified: false },
  legacy: {
    default_profile: false,
    default_profile_image: false,
    description: "Building small software in public. Writing about distribution and pricing.",
    entities: {
      description: { urls: [] },
      url: {
        urls: [
          {
            display_url: "example.com",
            expanded_url: "https://example.com",
            url: "https://t.co/abcdefghij",
            indices: [0, 23],
          },
        ],
      },
    },
    fast_followers_count: 0,
    favourites_count: 52_310 + i,
    followers_count: 1_000 * (i + 1),
    friends_count: 812,
    has_custom_timelines: true,
    is_translator: false,
    listed_count: 431,
    media_count: 2_204,
    normal_followers_count: 1_000 * (i + 1),
    pinned_tweet_ids_str: [String(1_800_000_000_000_000_000n + BigInt(i))],
    possibly_sensitive: false,
    profile_banner_url: `https://pbs.twimg.com/profile_banners/${4_419_639 + i}/1700000000`,
    profile_interstitial_type: "",
    statuses_count: 38_000 + i,
    translator_type: "none",
    url: "https://t.co/abcdefghij",
    want_retweets: false,
    withheld_in_countries: [],
  },
  tipjar_settings: {},
});

const photo = (id: string) => ({
  display_url: "pic.x.com/abcdefghij",
  expanded_url: `https://x.com/builder/status/${id}/photo/1`,
  id_str: `${id}1`,
  indices: [120, 143],
  media_key: `3_${id}1`,
  media_url_https: `https://pbs.twimg.com/media/${id}.jpg`,
  type: "photo",
  url: "https://t.co/abcdefghij",
  ext_media_availability: { status: "Available" },
  features: {
    large: { faces: [] },
    medium: { faces: [] },
    small: { faces: [] },
    orig: { faces: [] },
  },
  sizes: {
    large: { h: 1152, w: 2048, resize: "fit" },
    medium: { h: 675, w: 1200, resize: "fit" },
    small: { h: 383, w: 680, resize: "fit" },
    thumb: { h: 150, w: 150, resize: "crop" },
  },
  original_info: { height: 1152, width: 2048, focus_rects: [{ x: 0, y: 0, w: 2048, h: 1147 }] },
  media_results: { result: { media_key: `3_${id}1` } },
});

const tweet = (n: number, extra: Record<string, unknown> = {}) => {
  const id = String(1_850_000_000_000_000_000n + BigInt(n));
  const media = n % 3 === 0 ? [photo(id)] : [];
  return {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: user(n % 40) } },
    unmention_data: {},
    edit_control: {
      edit_tweet_ids: [id],
      editable_until_msecs: "1761109200000",
      is_edit_eligible: true,
      edits_remaining: "5",
    },
    is_translatable: false,
    views: { count: String(1_000 + n * 977), state: "EnabledWithCount" },
    source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
    grok_analysis_button: true,
    legacy: {
      bookmark_count: n * 3,
      bookmarked: false,
      created_at: "Wed Oct 22 04:00:00 +0000 2026",
      conversation_id_str: id,
      display_text_range: [0, 140],
      entities: {
        hashtags: [],
        symbols: [],
        timestamps: [],
        urls:
          n % 4 === 0
            ? [
                {
                  display_url: "example.com/post",
                  expanded_url: "https://example.com/post",
                  url: "https://t.co/abcdefghij",
                  indices: [100, 123],
                },
              ]
            : [],
        user_mentions: [],
        ...(media.length > 0 ? { media } : {}),
      },
      ...(media.length > 0 ? { extended_entities: { media } } : {}),
      favorite_count: n * 41,
      favorited: false,
      full_text:
        "Shipped the pricing page today. Three tiers felt like too many, so we cut to two and conversions went up. Small teams should copy less and test more.",
      is_quote_status: false,
      lang: "en",
      possibly_sensitive: false,
      possibly_sensitive_editable: true,
      quote_count: n % 7,
      reply_count: n * 2,
      retweet_count: n * 5,
      retweeted: false,
      user_id_str: String(4_419_639 + (n % 40)),
      id_str: id,
    },
    ...extra,
  };
};

const clientEventInfo = {
  component: "for_you_simclusters",
  element: "tweet",
  details: {
    timelinesDetails: {
      injectionType: "SimClusters",
      controllerData: "DAACDAABDAABCgABAAAAAAAAAAAKAAkAAAAAAAAAAAAAAAA",
    },
  },
};
const item = (result: unknown, promoted = false) => ({
  itemType: "TimelineTweet",
  __typename: "TimelineTweet",
  tweet_results: { result },
  tweetDisplayType: "Tweet",
  ...(promoted
    ? {
        promotedMetadata: {
          advertiser_results: { result: user(99) },
          disclosureType: "NoDisclosure",
          experimentValues: [],
          impressionId: "1a2b3c4d5e6f",
          impressionString: "1a2b3c4d5e6f",
        },
      }
    : {}),
});
const entry = (n: number, result: unknown, promoted = false) => ({
  entryId: `tweet-${n}`,
  sortIndex: String(1_900_000_000_000_000_000n - BigInt(n)),
  content: {
    entryType: "TimelineTimelineItem",
    __typename: "TimelineTimelineItem",
    itemContent: item(result, promoted),
    feedbackInfo: { feedbackKeys: ["1916243393"] },
    clientEventInfo,
  },
});

let n = 0;
const entries: Array<unknown> = [];
for (let i = 0; i < 50; i++) entries.push(entry(++n, tweet(n)));
for (let i = 0; i < 8; i++) {
  const original = tweet(++n);
  entries.push(
    entry(
      ++n,
      tweet(n, { legacy: { ...tweet(n).legacy, retweeted_status_result: { result: original } } }),
    ),
  );
}
for (let i = 0; i < 10; i++) {
  const quoted = tweet(++n);
  entries.push(entry(++n, tweet(n, { quoted_status_result: { result: quoted } })));
}
for (let i = 0; i < 4; i++) entries.push(entry(++n, tweet(n), true));
for (let i = 0; i < 5; i++)
  entries.push({
    entryId: `home-conversation-${i}`,
    sortIndex: String(1_800_000_000_000_000_000n - BigInt(i)),
    content: {
      entryType: "TimelineTimelineModule",
      __typename: "TimelineTimelineModule",
      displayType: "VerticalConversation",
      items: [++n, ++n].map((k) => ({
        entryId: `home-conversation-${i}-tweet-${k}`,
        item: { itemContent: item(tweet(k)) },
      })),
      clientEventInfo,
    },
  });

const text = JSON.stringify({
  data: {
    home: {
      home_timeline_urt: {
        instructions: [{ type: "TimelineAddEntries", entries }],
        metadata: { scribeConfig: { page: "for_you" } },
      },
    },
  },
});

test("normalizeGraphqlResponse", async ({ bench }) => {
  expect(normalizeGraphqlResponse(JSON.parse(text))).toHaveLength(100);
  // SessionCapture does both on Electron's main thread for every timeline response.
  const body: unknown = JSON.parse(text);
  await bench.compare(
    bench(`parse + normalize, ${Math.round(text.length / 1024)} KB, 100 posts`, () =>
      normalizeGraphqlResponse(JSON.parse(text))),
    bench("normalize only", () => normalizeGraphqlResponse(body)),
  );
});

import type { EngineBatch, EnginePost, EngineUser } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { at, emptyEngine, mergeBatch } from "../../state/engine";
import { formatFixture, parseFixture, scrub, shiftBatch, synth } from "./engineFixtures";

const real: EngineUser = {
  userId: "1450011223344",
  handle: "RealPerson_42",
  name: "Realname Surname",
  avatarUrl: "https://pbs.twimg.com/profile_images/1450011223344/face_normal.jpg",
  bannerUrl: "https://pbs.twimg.com/profile_banners/1450011223344/1600",
  bio: "Secretive founder at Hushlabs, Dhaka",
  location: "Gulshanpur",
  website: { url: "https://t.co/zzzqqq", display: "hushlabs.io" },
  joinedAt: "2015-01-01T00:00:00.000Z",
  followers: 1234,
  following: 56,
  posts: 789,
  verified: true,
  isProtected: false,
  youFollow: true,
  followsYou: false,
  pinnedPostId: "1888000000000000001",
  verifiedType: null,
  avatarShape: "Circle",
  affiliate: {
    name: "Hushlabs",
    badgeUrl: "https://pbs.twimg.com/badge.png",
    url: "https://x.com/hushlabs",
  },
};
const text = "Lunch with @RealPerson_42 about #Moonshot https://t.co/abcdefg";
const realPost = (postId: string, extra: Partial<EnginePost> = {}): EnginePost => ({
  postId,
  author: {
    userId: real.userId,
    handle: real.handle,
    name: real.name,
    followers: 1234,
    verified: true,
  },
  text,
  createdAt: "2026-10-30T08:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: true,
  hasLink: true,
  metrics: { views: 900, likes: 12, reposts: 1, replies: 2, quotes: 0, bookmarks: 3 },
  avatarUrl: real.avatarUrl,
  media: [
    {
      kind: "video",
      url: "https://pbs.twimg.com/ext_tw_video_thumb/1888/pu/img/still.jpg",
      videoUrl: "https://video.twimg.com/ext_tw_video/1888/pu/vid/720.mp4",
      width: 1280,
      height: 720,
      durationMs: 5000,
      altText: "Whiteboard at Hushlabs",
    },
  ],
  quotedId: null,
  replyToId: null,
  replyingTo: [],
  entities: {
    urls: [
      {
        url: "https://t.co/abcdefg",
        expanded: "https://hushlabs.io/launch",
        display: "hushlabs.io/launch",
        indices: [42, 62],
      },
    ],
    mentions: [{ handle: "RealPerson_42", indices: [11, 25] }],
    hashtags: [{ tag: "Moonshot", indices: [32, 41] }],
    cashtags: [],
  },
  card: null,
  poll: null,
  note: null,
  context: { type: "Retweet", text: "Realname Surname reposted", handle: "RealPerson_42" },
  liked: false,
  reposted: false,
  bookmarked: false,
  conversation: { id: "home-conversation-1888", index: 0, size: 1 },
  edits: [postId],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
  ...extra,
});
const recorded: ReadonlyArray<EngineBatch> = [
  {
    op: "TweetDetail",
    key: "1888000000000000001",
    cursor: "DAABCgABGxxSECRETCURSOR",
    top: null,
    bottom: "DAABCgABGxxBOTTOMCURSOR",
    posts: [
      realPost("1888000000000000001"),
      realPost("1888000000000000002", { replyToId: "1888000000000000001", isReply: true }),
    ],
    users: [real],
    people: [real.userId],
    order: ["1888000000000000001", "1888000000000000002"],
    trends: [],
    notifications: [
      {
        id: "notif-77",
        kind: "event",
        icon: "heart_icon",
        text: "Realname Surname liked your post",
        at: "2026-10-30T09:00:00.000Z",
        users: [real],
        postIds: ["1888000000000000001"],
      },
    ],
    lists: [],
    communities: [],
    homeTabs: null,
    exploreTabs: null,
    viewer: { userId: "1450099999999", handle: "siamships", name: "Ehsanul Siam", avatarUrl: null },
  },
];

it("leaves nothing of the account it was recorded on: no id, handle, name, word, image or cursor", () => {
  const out = JSON.stringify(scrub(recorded));
  for (const secret of [
    "1450011223344",
    "1888000000000000001",
    "RealPerson",
    "realperson",
    "Realname",
    "Surname",
    "Secretive",
    "Hushlabs",
    "hushlabs",
    "Gulshanpur",
    "Moonshot",
    "Lunch",
    "Whiteboard",
    "twimg",
    "t.co/abcdefg",
    "SECRETCURSOR",
    "home-conversation",
    "siamships",
    "Ehsanul",
    "1450099999999",
  ])
    expect(out).not.toContain(secret);
});

it("keeps what the screens need: relations, text shape and entity offsets, and @you as the viewer", () => {
  const [out] = scrub(recorded);
  const [focal, reply] = out!.posts;
  expect(out!.key).toBe(focal!.postId);
  expect(reply!.replyToId).toBe(focal!.postId);
  expect(out!.order).toEqual([focal!.postId, reply!.postId]);
  expect(focal!.text).toHaveLength(text.length);
  const [from, to] = focal!.entities.mentions[0]!.indices;
  expect(focal!.text.slice(from, to)).toMatch(/^@\w+$/);
  expect(focal!.author.handle).toBe(focal!.entities.mentions[0]!.handle);
  expect(out!.users[0]!.pinnedPostId).toBe(focal!.postId);
  expect(focal!.media[0]).toMatchObject({ kind: "photo", videoUrl: null });
  expect(out!.viewer?.handle).toBe("you");
  expect(focal!.metrics).toEqual(recorded[0]!.posts[0]!.metrics);
  // A stand-in person's name and handle go together, as a real one's do.
  for (const { author } of [focal!, reply!])
    expect(author.handle.startsWith(author.name.split(" ")[0]!.toLowerCase())).toBe(true);
});

it("draws every native screen from the made-up fixtures, through the store's own merge", () => {
  const all = synth();
  const state = Object.values(all)
    .flatMap((f) => parseFixture(formatFixture(f)).batches)
    .reduce(mergeBatch, emptyEngine);
  expect(at(state.lists, "following").length).toBeGreaterThan(5);
  expect(at(state.lists, "forYou").length).toBeGreaterThan(3);
  expect(at(state.notifications, "notifications").length).toBeGreaterThan(2);
  expect(at(state.lists, "bookmarks")).toHaveLength(3);
  expect(at(state.trends, "explore:explore-for-you").length).toBeGreaterThan(2);
  expect(state.xLists.size).toBe(2);
  expect(state.viewer?.handle).toBe("you");
  for (const fixture of Object.values(all)) expect(fixture.meta.open.length).toBeGreaterThan(0);
});

it("moves a batch's times by the replay's shift", () => {
  const [moved] = synth()
    .home!.batches.slice(1)
    .map((b) => shiftBatch(b, 60_000));
  const [before] = synth().home!.batches.slice(1);
  expect(Date.parse(moved!.posts[0]!.createdAt) - Date.parse(before!.posts[0]!.createdAt)).toBe(
    60_000,
  );
});

import type { EngineBatch, EngineNotification, EnginePost, EngineUser } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import {
  at,
  emptyEngine,
  mergeBatch,
  postOn,
  resetSurface,
  showWaiting,
  surfacesOf,
  userByHandle,
} from "./engine";

const post = (postId: string, createdAt: string, quotedId: string | null = null): EnginePost => ({
  postId,
  author: { userId: "1", handle: "ann", name: "Ann", followers: 10, verified: false },
  text: postId,
  createdAt,
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 1, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  avatarUrl: null,
  media: [],
  quotedId,
  replyToId: null,
  replyingTo: [],
  entities: { urls: [], mentions: [], hashtags: [], cashtags: [] },
  card: null,
  poll: null,
  note: null,
  context: null,
  liked: false,
  reposted: false,
  bookmarked: false,
  conversation: null,
  edits: [],
  editsRemaining: null,
  editableUntil: null,
  aiGenerated: false,
  translation: null,
});

const batch = (
  op: string,
  posts: ReadonlyArray<EnginePost>,
  extra: Partial<EngineBatch> = {},
): EngineBatch => ({
  op,
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts,
  users: [],
  people: [],
  order: [],
  trends: [],
  notifications: [],
  lists: [],
  homeTabs: null,
  exploreTabs: null,
  viewer: null,
  ...extra,
});

it("keeps X's order, leaves quoted posts out of the list, and holds newer posts behind the pill", () => {
  let state = mergeBatch(
    emptyEngine,
    batch(
      "HomeLatestTimeline",
      [
        post("2", "2026-10-31T02:00:00Z", "9"),
        post("9", "2026-10-30T00:00:00Z"),
        post("1", "2026-10-31T01:00:00Z"),
      ],
      {
        top: "t1",
        bottom: "b1",
      },
    ),
  );
  expect(state.lists.following).toEqual(["2", "1"]);
  expect(state.posts.has("9")).toBe(true);

  // The next page, with one post already shown: only the new one joins, at the bottom.
  state = mergeBatch(
    state,
    batch(
      "HomeLatestTimeline",
      [post("1", "2026-10-31T01:00:00Z"), post("0", "2026-10-30T23:00:00Z")],
      { cursor: "b1", bottom: "b2" },
    ),
  );
  expect(state.lists.following).toEqual(["2", "1", "0"]);

  // X's "new posts" fetch asks with the top cursor: what it brings waits, the list does not move.
  state = mergeBatch(
    state,
    batch("HomeLatestTimeline", [post("3", "2026-10-31T03:00:00Z")], { cursor: "t1", top: "t2" }),
  );
  expect(state.lists.following).toEqual(["2", "1", "0"]);
  expect(state.waiting.following).toEqual(["3"]);
  state = showWaiting(state, "following");
  expect(state.lists.following).toEqual(["3", "2", "1", "0"]);

  // An operation no screen draws only feeds the store.
  state = mergeBatch(state, batch("UserFollowers", [post("7", "2026-10-29T00:00:00Z")]));
  expect(state.posts.has("7")).toBe(true);
  expect(state.lists.forYou).toEqual([]);
});

it("tells For you's ranked pages apart by cursor, not by date", () => {
  let state = mergeBatch(
    emptyEngine,
    batch("HomeTimeline", [post("1", "2026-10-01T00:00:00Z")], { top: "t", bottom: "b" }),
  );
  // A next page of posts all newer than the top still belongs at the bottom.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("2", "2026-10-31T00:00:00Z")], { cursor: "b", bottom: "b2" }),
  );
  expect(state.lists.forYou).toEqual(["1", "2"]);
  // X reloading its first page while the list shows posts: the new ones wait, and once shown the
  // top follows X's page, posts already listed included.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("2", "2026-10-31T00:00:00Z"), post("3", "2026-09-01T00:00:00Z")]),
  );
  expect([state.lists.forYou, state.waiting.forYou]).toEqual([["1", "2"], ["3"]]);
  expect(showWaiting(state, "forYou").lists.forYou).toEqual(["2", "3", "1"]);
});

it("files pinned Home tabs, Lists, Communities and Explore tabs under their own surface", () => {
  expect(surfacesOf({ op: "HomeTimeline", key: "tag:19" })[0]).toBe("tag:19");
  expect(surfacesOf({ op: "HomeTimeline", key: null })[0]).toBe("forYou");
  expect(surfacesOf({ op: "CommunityTweetsTimeline", key: "community:14" })[0]).toBe(
    "community:14",
  );
  expect(surfacesOf({ op: "ListLatestTweetsTimeline", key: "list:12" })[0]).toBe("list:12");
  expect(surfacesOf({ op: "NotificationsTimeline", key: "Mentions" })[0]).toBe(
    "notifications:mentions",
  );
  expect(surfacesOf({ op: "GenericTimelineById", key: "VTR" })[0]).toBe("explore:VTR");
  // A profile tab, a search and a thread each keep their own list and mirror the last one fetched.
  expect(surfacesOf({ op: "UserVideoTimeline", key: "5" })).toEqual([
    "profile:media:5",
    "profile:media",
  ]);
  expect(surfacesOf({ op: "SearchTimeline", key: "Latest:from:theo" })).toEqual([
    "search:Latest:from:theo",
    "search",
  ]);
  expect(surfacesOf({ op: "TweetDetail", key: "42" })).toEqual(["post:42", "post"]);
  expect(surfacesOf({ op: "UserFollowers", key: null })).toEqual([]);

  const state = mergeBatch(
    emptyEngine,
    batch("HomeTimeline", [post("1", "2026-10-01T00:00:00Z")], {
      key: "tag:19",
      homeTabs: [{ id: "tag:19", label: "Tech" }],
    }),
  );
  expect(at(state.lists, "tag:19")).toEqual(["1"]);
  expect(at(state.lists, "community:14")).toEqual([]);
  expect(state.homeTabs).toEqual([{ id: "tag:19", label: "Tech" }]);
});

it("keeps notifications in X's order, newer on top, and people by surface", () => {
  const note = (id: string): EngineNotification => ({
    id,
    kind: "event",
    icon: "heart_icon",
    text: id,
    at: null,
    users: [],
    postIds: [],
  });
  let state = mergeBatch(
    emptyEngine,
    batch("NotificationsTimeline", [], {
      key: "All",
      notifications: [note("b"), note("a")],
      top: "t",
    }),
  );
  state = mergeBatch(
    state,
    batch("NotificationsTimeline", [], {
      key: "All",
      cursor: "t",
      notifications: [note("c"), note("b")],
    }),
  );
  expect(state.notifications.notifications.map((n) => n.id)).toEqual(["c", "b", "a"]);

  const user = (userId: string, handle: string): EngineUser => ({
    userId,
    handle,
    name: handle,
    avatarUrl: null,
    bannerUrl: null,
    bio: "",
    location: null,
    website: null,
    joinedAt: null,
    followers: 1,
    following: 1,
    posts: 1,
    verified: false,
    isProtected: false,
    youFollow: false,
    followsYou: false,
    pinnedPostId: null,
    verifiedType: null,
    avatarShape: "Circle",
    affiliate: null,
  });
  // X listed theo as a person; ann only wrote a post. Both are known, only theo is listed.
  state = mergeBatch(
    state,
    batch("SearchTimeline", [], {
      key: "People:react",
      users: [user("5", "theo"), user("1", "ann")],
      people: ["5"],
    }),
  );
  expect(at(state.people, "search:People:react")).toEqual(["5"]);
  expect(state.people.search).toEqual(["5"]);
  expect(userByHandle(state, "Theo")?.userId).toBe("5");
  expect(userByHandle(state, "ann")?.userId).toBe("1");
  expect(resetSurface(state, "search").people.search).toEqual([]);
});

it("keeps the signed-in account's id when X's nav names it again without one", () => {
  let state = mergeBatch(
    emptyEngine,
    batch("Viewer", [], { viewer: { userId: "7", handle: "siam", name: "Siam", avatarUrl: null } }),
  );
  state = mergeBatch(
    state,
    batch("ViewerFromNav", [], {
      viewer: {
        userId: null,
        handle: "siam",
        name: "Siam H",
        avatarUrl: "https://pbs.twimg.com/a_normal.jpg",
      },
    }),
  );
  expect(state.viewer).toEqual({
    userId: "7",
    handle: "siam",
    name: "Siam H",
    avatarUrl: "https://pbs.twimg.com/a_normal.jpg",
  });
});

it("keeps a post's context per page, and lets a thread's newer replies in at once", () => {
  const reposted = {
    ...post("2", "2026-10-31T00:00:00Z"),
    context: { type: "Retweet", text: "Theo reposted", handle: "theo" },
  };
  let state = mergeBatch(emptyEngine, batch("HomeLatestTimeline", [reposted]));
  // The post's own thread page sends the same post with no context.
  state = mergeBatch(
    state,
    batch("TweetDetail", [post("2", "2026-10-31T00:00:00Z")], { key: "2", top: "t" }),
  );
  expect(postOn(state, "following", "2")?.context?.text).toBe("Theo reposted");
  expect(postOn(state, "post:2", "2")?.context).toBeNull();
  // Refreshing the thread brings a newer reply: it shows, no pill.
  state = mergeBatch(
    state,
    batch("TweetDetail", [post("3", "2026-10-31T01:00:00Z")], { key: "2", cursor: "t" }),
  );
  expect([at(state.lists, "post:2"), at(state.waiting, "post:2")]).toEqual([["2", "3"], []]);
});

it("lists a pinned post X also shows quoted, in X's entry order", () => {
  // The newer post quotes the pinned one; X lists both, the pinned one first.
  const state = mergeBatch(
    emptyEngine,
    batch(
      "UserOriginalsTimeline",
      [post("1", "2026-10-30T00:00:00Z"), post("2", "2026-10-31T00:00:00Z", "1")],
      {
        key: "5",
        order: ["1", "2"],
      },
    ),
  );
  expect(at(state.lists, "profile:posts:5")).toEqual(["1", "2"]);
});

it("puts the user's new reply under the post it answers, and a new post on top of Home", () => {
  const thread = [post("1", "2026-10-30T00:00:00Z"), post("2", "2026-10-30T01:00:00Z")];
  let state = mergeBatch(
    emptyEngine,
    batch("TweetDetail", thread, { key: "1", order: ["1", "2"] }),
  );
  state = mergeBatch(state, batch("HomeLatestTimeline", [post("3", "2026-10-30T02:00:00Z")]));
  const reply = { ...post("9", "2026-10-31T00:00:00Z"), replyToId: "1" };
  state = mergeBatch(state, batch("CreateTweet", [reply]));
  expect(at(state.lists, "post:1")).toEqual(["1", "9", "2"]);
  expect(state.posts.get("1")?.metrics.replies).toBe(1);
  const quote = { ...post("10", "2026-10-31T01:00:00Z"), quotedId: "3" };
  state = mergeBatch(state, batch("CreateNoteTweet", [quote, post("3", "2026-10-30T02:00:00Z")]));
  expect(at(state.lists, "following")).toEqual(["10", "3"]);
  expect(at(state.lists, "profile:posts:1")).toEqual(["10"]);
});

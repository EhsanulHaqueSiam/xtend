import type {
  EngineBatch,
  EngineCommunity,
  EngineGame,
  EngineGif,
  EngineList,
  EngineNotification,
  EnginePost,
  EngineProfileSave,
  EngineUser,
} from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { synth } from "../components/xnative/engineFixtures";
import {
  ANALYTICS_CLAIM,
  askFollow,
  askList,
  askMembership,
  askPin,
  at,
  communityPinned,
  communityRole,
  communitySearchSurface,
  analyticsRange,
  communitySurface,
  endAnalyticsPick,
  emptyEngine,
  gameSurface,
  type EngineState,
  gifSurface,
  hideTrend,
  inspirationSurface,
  listFollowing,
  listPinned,
  mergeBatch,
  pickAnalyticsRange,
  postOn,
  postSurface,
  profileSurface,
  roleIn,
  radarSurface,
  resetSurface,
  sawAnalyticsPage,
  sawAnalyticsRange,
  showWaiting,
  surfacesOf,
  userByHandle,
  youFollow,
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
  sections: [],
  order: [],
  modules: [],
  trends: [],
  notifications: [],
  lists: [],
  communities: [],
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

it("keeps X's Who to follow among the posts across pages and the pill", () => {
  const wtf = (id: string) => ({ id, title: "Who to follow", userIds: ["5"] });
  const hour = (h: number) => `2026-10-01T0${h}:00:00Z`;
  let state = mergeBatch(
    emptyEngine,
    batch("HomeTimeline", [post("1", hour(3)), post("2", hour(2))], {
      order: ["1", "wtf-a", "2"],
      modules: [wtf("wtf-a")],
      top: "t",
      bottom: "b",
    }),
  );
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("3", hour(1))], {
      cursor: "b",
      bottom: "b2",
      order: ["wtf-b", "3"],
      modules: [wtf("wtf-b")],
    }),
  );
  expect(state.lists.forYou).toEqual(["1", "wtf-a", "2", "wtf-b", "3"]);
  expect(state.modules.get("wtf-b")?.userIds).toEqual(["5"]);
  // X's first page again: a new post and its module wait behind the pill, and show in X's order.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("4", hour(4)), post("1", hour(3))], {
      order: ["4", "wtf-c", "1"],
      modules: [wtf("wtf-c")],
    }),
  );
  expect([state.lists.forYou, state.waiting.forYou]).toEqual([
    ["1", "wtf-a", "2", "wtf-b", "3"],
    ["4", "wtf-c"],
  ]);
  // The same top again with one more module, while the pill waits: it waits too, in X's order.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("4", hour(4)), post("1", hour(3))], {
      order: ["4", "wtf-c", "wtf-f", "1"],
      modules: [wtf("wtf-c"), wtf("wtf-f")],
    }),
  );
  // Again without the waiting post: its module still waits, above the post X put it before.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("2", hour(2))], {
      order: ["wtf-g", "2"],
      modules: [wtf("wtf-g")],
    }),
  );
  expect(state.lists.forYou).toEqual(["1", "wtf-a", "2", "wtf-b", "3"]);
  state = showWaiting(state, "forYou");
  expect(state.lists.forYou).toEqual([
    "4",
    "wtf-c",
    "wtf-f",
    "1",
    "wtf-a",
    "wtf-g",
    "2",
    "wtf-b",
    "3",
  ]);
  // Again with no new post: its module shows where X put it, not at the end and not dropped.
  state = mergeBatch(
    state,
    batch("HomeTimeline", [post("4", hour(4)), post("1", hour(3))], {
      order: ["wtf-d", "4", "1", "wtf-e"],
      modules: [wtf("wtf-d"), wtf("wtf-e")],
    }),
  );
  expect([state.lists.forYou, state.waiting.forYou]).toEqual([
    ["wtf-d", "4", "wtf-c", "wtf-f", "1", "wtf-e", "wtf-a", "wtf-g", "2", "wtf-b", "3"],
    [],
  ]);
});

it("pages Explore's For you in after what it shows, and takes X's first page again whole", () => {
  const hour = (h: number) => `2026-10-01T0${h}:00:00Z`;
  const titled = (id: string) => ({ id, title: "Posts For You", userIds: [] });
  const forYou = (posts: ReadonlyArray<EnginePost>, extra: Partial<EngineBatch>) =>
    batch("ExplorePage", posts, { key: "VF9", ...extra });
  let state = mergeBatch(
    emptyEngine,
    forYou([post("1", hour(3)), post("2", hour(2))], {
      order: ["wtf", "pfy", "1", "2"],
      modules: [{ id: "wtf", title: "Who to follow", userIds: ["5"] }, titled("pfy")],
      top: "t1",
      bottom: "b1",
    }),
  );
  // X ranks For you, so a later page may hold newer posts: it still goes under the list.
  state = mergeBatch(
    state,
    forYou([post("3", hour(5))], { cursor: "b1", order: ["3"], top: "t2", bottom: "b2" }),
  );
  expect(at(state.lists, "explore:VF9")).toEqual(["wtf", "pfy", "1", "2", "3"]);
  // X's first page again (a refresh) is the tab anew: it replaces the list, and nothing waits.
  state = mergeBatch(
    state,
    forYou([post("4", hour(6)), post("1", hour(3))], {
      order: ["pfy2", "4", "1"],
      modules: [titled("pfy2")],
      top: "t3",
      bottom: "b3",
    }),
  );
  expect([at(state.lists, "explore:VF9"), at(state.waiting, "explore:VF9")]).toEqual([
    ["pfy2", "4", "1"],
    [],
  ]);
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
  expect(surfacesOf({ op: "TweetDetail", key: "42:Recency" })).toEqual([
    postSurface("42", "Recency"),
    "post",
  ]);
  expect(surfacesOf({ op: "Retweeters", key: "42" })).toEqual(["reposters:42"]);
  expect(surfacesOf({ op: "Favoriters", key: "42" })).toEqual(["likers:42"]);
  expect(surfacesOf({ op: "ListMembers", key: "list:12" })).toEqual(["listMembers:12"]);
  expect(surfacesOf({ op: "ListSubscribers", key: "list:12" })).toEqual(["listFollowers:12"]);
  // A profile's people pages, each its own list per person.
  expect(
    ["BlueVerifiedFollowers", "FollowersYouKnow", "Followers", "Following"].map(
      (op) => surfacesOf({ op, key: "5" })[0],
    ),
  ).toEqual(["verified_followers:5", "followers_you_follow:5", "followers:5", "following:5"]);
  expect(surfacesOf({ op: "ConnectTabTimeline", key: "connect:creators" })).toEqual([
    "connect:creators",
  ]);
  expect(surfacesOf({ op: "ConnectTabTimeline", key: null })).toEqual([]);
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

  // X's Communities hub, and a Community's tabs: Top is Home's pinned tab's list.
  expect(surfacesOf({ op: "CommunitiesRankedTimeline", key: null })).toEqual(["communities:home"]);
  expect(surfacesOf({ op: "CarouselQuery", key: null })).toEqual(["communities:mine"]);
  expect(surfacesOf({ op: "CommunityTweetsTimeline", key: "community:14:Recency" })).toEqual([
    communitySurface("14", "Latest"),
  ]);
  expect(surfacesOf({ op: "CommunityMediaTimeline", key: "community:14" })).toEqual([
    communitySurface("14", "Media"),
  ]);
  expect(surfacesOf({ op: "CommunityAboutTimeline", key: "community:14" })).toEqual([
    communitySurface("14", "About"),
  ]);
  expect(surfacesOf({ op: "CommunityQuery", key: "community:14" })).toEqual([]);
  expect(
    surfacesOf({
      op: "CommunityTweetSearchModuleQuery",
      key: "communitySearch:14:Recency:ship it",
    }),
  ).toEqual([communitySearchSurface("14", "Recency", "ship it")]);

  // X's Inspiration lists each set of filters on its own, and its latest answer is what X shows.
  const weekly = { engagement: "Replies", period: "Weekly", language: "en" };
  const answer = (...ids: ReadonlyArray<string>) =>
    batch(
      "GenericTimelineById",
      ids.map((id) => post(id, "2026-10-01T00:00:00Z")),
      { key: "inspiration:Replies:Weekly:en" },
    );
  const inspired = mergeBatch(state, answer("1", "2"));
  expect([
    at(inspired.lists, inspirationSurface(weekly)),
    inspired.inspiration,
    mergeBatch(inspired, batch("GenericTimelineById", [], { key: "VTR" })).inspiration,
    state.inspiration,
  ]).toEqual([["1", "2"], weekly, weekly, null]);
  // X's next first page is its ranking again: it replaces the list, and nothing waits on a pill.
  const again = mergeBatch(inspired, answer("3", "2"));
  expect([
    at(again.lists, inspirationSurface(weekly)),
    at(again.waiting, inspirationSurface(weekly)),
  ]).toEqual([["3", "2"], []]);

  // X's search of Communities from the hub, keyed by its query: one list per tab.
  expect([
    surfacesOf({ op: "CommunitiesSearchQuery", key: "ship it" }),
    surfacesOf({ op: "GlobalCommunitiesPostSearchTimeline", key: "ship it" }),
    surfacesOf({ op: "GlobalCommunitiesLatestPostSearchTimeline", key: "ship it" }),
    surfacesOf({ op: "CommunitiesSearchQuery", key: null }),
  ]).toEqual([
    ["communitiesSearch:ship it"],
    ["communityPostsSearch:Top:ship it"],
    ["communityPostsSearch:Latest:ship it"],
    [],
  ]);
});

it("lists the user's Communities in X's order, and keeps what each response said of one", () => {
  const community = (id: string, extra: Partial<EngineCommunity> = {}): EngineCommunity => ({
    communityId: id,
    name: `C${id}`,
    description: null,
    bannerUrl: null,
    members: null,
    topic: null,
    rules: null,
    joinPolicy: null,
    role: null,
    ...extra,
  });
  // X's card for it first, then the carousel's tile, which names only its name and banner.
  const card = batch("CommunitiesFetchOneQuery", [], {
    key: "community:20",
    communities: [community("20", { members: 9, role: "Member", rules: [] })],
  });
  const carousel = batch("CarouselQuery", [], {
    communities: [community("21"), community("20", { name: "Renamed", bannerUrl: "b.jpg" })],
  });
  const state = [card, carousel].reduce(mergeBatch, emptyEngine);
  expect(at(state.communityIds, "communities:mine")).toEqual(["21", "20"]);
  expect(state.communities.get("20")).toEqual(
    community("20", { name: "Renamed", bannerUrl: "b.jpg", members: 9, role: "Member", rules: [] }),
  );
  // A first page again (the carousel loaded anew) is X's list now, even once the user left them all.
  const again = mergeBatch(state, batch("CarouselQuery", [], { communities: [community("20")] }));
  expect(at(again.communityIds, "communities:mine")).toEqual(["20"]);
  const none = mergeBatch(again, batch("CarouselQuery", [], { key: "communities:mine" }));
  expect(at(none.communityIds, "communities:mine")).toEqual([]);
});

it("sums what X tells a Community's moderators across answers, and its Admin tools name the role", () => {
  // X's Admin tools: counts and the role, no name; then X's fetch of it for its settings.
  const tools = batch("CommunityToolsScreenContainerQuery", [], {
    communityAdmin: [{ communityId: "20", role: "Moderator", reported: 3, requests: 4 }],
  });
  const fetched = batch("CommunitiesFetchOneQuery", [], {
    communityAdmin: [{ communityId: "20", question: null, searchTags: ["saas"], nsfw: false }],
  });
  const state = [tools, fetched].reduce(mergeBatch, emptyEngine);
  expect(state.communityAdmin.get("20")).toEqual({
    communityId: "20",
    role: "Moderator",
    reported: 3,
    requests: 4,
    question: null,
    searchTags: ["saas"],
    nsfw: false,
  });
  expect(roleIn(state, "20")).toBe("Moderator");
  // X's page answers afresh: the reports handled, and the role X now gives the viewer.
  const later = mergeBatch(
    state,
    batch("CommunityQuery", [], {
      communities: [
        {
          communityId: "20",
          name: "C20",
          description: null,
          bannerUrl: null,
          members: null,
          topic: null,
          rules: null,
          joinPolicy: null,
          role: "Admin",
        },
      ],
      communityAdmin: [{ communityId: "20", reported: 0 }],
    }),
  );
  expect([later.communityAdmin.get("20")?.reported, roleIn(later, "20")]).toEqual([0, "Admin"]);
  expect(roleIn(later, "21")).toBeNull();
  // X's create button, as X's answer offers it, stays until X says otherwise.
  const offered = mergeBatch(
    later,
    batch("CommunitiesCreateButtonQuery", [], { communityCreate: "verify" }),
  );
  expect(mergeBatch(offered, batch("Viewer", [])).communityCreate).toBe("verify");
});

it("keeps what X took for a join, ask or leave until X's capture of the Community agrees", () => {
  const card = (role: string): EngineBatch =>
    batch("CommunitiesFetchOneQuery", [], {
      key: "community:20",
      communities: [
        {
          communityId: "20",
          name: "C",
          description: null,
          bannerUrl: null,
          members: null,
          topic: null,
          rules: null,
          joinPolicy: "Open",
          role,
        },
      ],
    });
  const joined = mergeBatch(emptyEngine, card("Member"));
  const c = () => joined.communities.get("20")!;
  // The user left; X's cached page sends nothing, and an older capture still says Member.
  const left = askMembership(joined, "20", "NonMember");
  const stale = mergeBatch(left, card("Member"));
  expect(communityRole(stale, c())).toBe("NonMember");
  const agreed = mergeBatch(stale, card("NonMember"));
  expect([agreed.membership.size, communityRole(agreed, agreed.communities.get("20")!)]).toEqual([
    0,
    "NonMember",
  ]);
  // A request stands while X still says NonMember, and ends once X makes them a member.
  const asked = mergeBatch(askMembership(agreed, "20", "Requested"), card("NonMember"));
  expect(communityRole(asked, c())).toBe("Requested");
  expect(mergeBatch(asked, card("Member")).membership.size).toBe(0);
});

it("holds a pin or unpin X took until X's pinned tabs agree", () => {
  const tabs = (...ids: ReadonlyArray<string>): EngineBatch =>
    batch("PinnedTimelines", [], {
      homeTabs: ids.map((id) => ({ id: `community:${id}`, label: `C${id}` })),
    });
  const before = mergeBatch(emptyEngine, tabs("21"));
  expect([communityPinned(before, "20"), communityPinned(before, "21")]).toEqual([false, true]);
  // Pinned on X; X's next pinned tabs, sent before the press, still leave it out.
  const pinned = mergeBatch(askPin(before, "20", true), tabs("21"));
  expect(communityPinned(pinned, "20")).toBe(true);
  // Home's tab row draws only what X sends: nothing local joins it.
  expect(pinned.homeTabs.map((t) => t.id)).toEqual(["community:21"]);
  // A response with no pinned tabs says nothing either way.
  expect(communityPinned(mergeBatch(pinned, batch("HomeTimeline", [])), "20")).toBe(true);
  const agreed = mergeBatch(pinned, tabs("21", "20"));
  expect([agreed.pinned.size, communityPinned(agreed, "20")]).toEqual([0, true]);
  // Unpinned: held until X's tabs drop it.
  const unpinned = mergeBatch(askPin(agreed, "21", false), tabs("21", "20"));
  expect(communityPinned(unpinned, "21")).toBe(false);
  expect(mergeBatch(unpinned, tabs("20")).pinned.size).toBe(0);
});

const list = (
  listId: string,
  group: string | null,
  extra: Partial<EngineList> = {},
): EngineList => ({
  listId,
  name: `L${listId}`,
  description: "",
  members: 1,
  followers: 0,
  isPrivate: false,
  bannerUrl: null,
  owner: null,
  group,
  ...extra,
});

it("keeps a List's section and row button across its own page, and files one X just created first under Your Lists", () => {
  const page = mergeBatch(
    emptyEngine,
    batch("ListsManagementPageTimeline", [], {
      lists: [
        list("1", "Discover new Lists", { button: "follow" }),
        list("2", "Your Lists", { button: "pin" }),
      ],
    }),
  );
  // A List's own page names no section or row button: the Lists page's stay.
  const opened = mergeBatch(
    page,
    batch("ListByRestId", [], { key: "list:2", lists: [list("2", null, { name: "Renamed" })] }),
  );
  expect(opened.xLists.get("2")).toMatchObject({
    name: "Renamed",
    group: "Your Lists",
    button: "pin",
  });
  // X fetches nothing after its Create a new List: the List it answered with goes first.
  const made = mergeBatch(opened, batch("CreateList", [], { lists: [list("3", null)] }));
  expect(at(made.listIds, "lists")).toEqual(["1", "3", "2"]);
  expect(made.xLists.get("3")).toMatchObject({ group: "Your Lists", button: "pin" });
  // Deleted in X's Edit List: off the Lists page and Home's pinned tabs.
  const pinned = mergeBatch(
    made,
    batch("PinnedTimelines", [], { homeTabs: [{ id: "list:3", label: "L3" }] }),
  );
  const deleted = mergeBatch(pinned, batch("DeleteList", [], { listDeleted: "3" }));
  expect([at(deleted.listIds, "lists"), deleted.xLists.has("3"), deleted.homeTabs]).toEqual([
    ["1", "2"],
    false,
    [],
  ]);
  // Followed: X files it first under Your Lists with its Pin; unfollowed, it leaves Your Lists.
  const unsubscribe = (id: string) =>
    batch("ListUnsubscribe", [], { lists: [list(id, null, { following: false, pinned: false })] });
  const followed = mergeBatch(
    page,
    batch("ListSubscribe", [], { lists: [list("4", null, { following: true })] }),
  );
  expect([at(followed.listIds, "lists"), followed.xLists.get("4")?.button]).toEqual([
    ["1", "4", "2"],
    "pin",
  ]);
  expect(at(mergeBatch(followed, unsubscribe("4")).listIds, "lists")).toEqual(["1", "2"]);
  // X keeps a List it suggests under Discover new Lists there.
  expect(at(mergeBatch(page, unsubscribe("1")).listIds, "lists")).toEqual(["1", "2"]);
});

it("holds a List follow or pin X took until X's answer for that List agrees", () => {
  const header = (extra: Partial<EngineList>) =>
    batch("ListByRestId", [], { key: "list:5", lists: [list("5", null, extra)] });
  const followed = askList(mergeBatch(emptyEngine, header({ following: false })), "5", {
    following: true,
  });
  // X's page answered before the click: it still says not following.
  const stale = mergeBatch(followed, header({ following: false }));
  expect(listFollowing(stale, stale.xLists.get("5")!)).toBe(true);
  const agreed = mergeBatch(stale, header({ following: true }));
  expect(agreed.listFollows.size).toBe(0);
  // A pin holds until the List, or Home's pinned tabs, say so; a call saying neither leaves it.
  // `tabs` is a whole Home answer, naming every List pinned; `partial` one that names some.
  const partial = (...ids: ReadonlyArray<string>) =>
    batch("PinnedTimelines", [], {
      homeTabs: ids.map((id) => ({ id: `list:${id}` as const, label: id })),
    });
  const tabs = (...ids: ReadonlyArray<string>) => ({ ...partial(...ids), pinnedLists: ids });
  const pinned = askList(agreed, "5", { pinned: true });
  expect(listPinned(mergeBatch(pinned, batch("HomeTimeline", [])), list("5", null))).toBe(true);
  expect(mergeBatch(pinned, tabs("5")).listPins.size).toBe(0);
  // X's Lists page answers from before the pin, then Home lists the tab: Home's word stands.
  const listsPage = (on: boolean) =>
    batch("ListsManagementPageTimeline", [], {
      lists: [list("5", "Your Lists", { pinned: on, button: "pin" })],
    });
  const confirmed = mergeBatch(mergeBatch(pinned, listsPage(false)), tabs("5"));
  expect([confirmed.listPins.size, listPinned(confirmed, confirmed.xLists.get("5")!)]).toEqual([
    0,
    true,
  ]);
  // Home confirms the pin, then X's Lists page answers from before it: Home's word stands.
  const later = mergeBatch(mergeBatch(pinned, tabs("5")), listsPage(false));
  expect([later.listPins.size, listPinned(later, later.xLists.get("5")!)]).toEqual([0, true]);
  // A partial Home answer leaving a pinned List out unpins nothing.
  const shown = mergeBatch(agreed, listsPage(true));
  const missing = mergeBatch(shown, partial());
  expect(listPinned(missing, missing.xLists.get("5")!)).toBe(true);
  // Unfollowed while that pin is still held: X unpins it, and the hold goes with it.
  const dropped = mergeBatch(
    pinned,
    batch("ListUnsubscribe", [], { lists: [list("5", null, { following: false, pinned: false })] }),
  );
  expect([dropped.listPins.size, listPinned(mergeBatch(dropped, tabs()), list("5", null))]).toEqual(
    [0, false],
  );
  // Unfollowed: X takes it off Home's pinned tabs too.
  const unfollowed = mergeBatch(
    mergeBatch(agreed, tabs("5")),
    batch("ListUnsubscribe", [], { lists: [list("5", null, { following: false, pinned: false })] }),
  );
  expect([unfollowed.homeTabs, listPinned(unfollowed, unfollowed.xLists.get("5")!)]).toEqual([
    [],
    false,
  ]);
  // X's pin and unpin answers move Home's tab too, for a Home X then serves from its cache.
  const answer = (on: boolean) =>
    batch(on ? "PinTimeline" : "UnpinTimeline", [], { lists: [list("5", null, { pinned: on })] });
  const onHome = mergeBatch(mergeBatch(agreed, tabs("3")), answer(true));
  expect(onHome.homeTabs.map((t) => t.id)).toEqual(["list:3", "list:5"]);
  expect(mergeBatch(onHome, answer(false)).homeTabs.map((t) => t.id)).toEqual(["list:3"]);
});

it("replaces a profile's people page with X's first page even when X now lists nobody", () => {
  const followers = (cursor: string | null, people: ReadonlyArray<string>) =>
    batch("Followers", [], { key: "5", cursor, bottom: "next", people });
  const listed = mergeBatch(emptyEngine, followers(null, ["11", "12"]));
  // A later page with nobody on it keeps the rows; a fresh first page with nobody empties them.
  expect(at(mergeBatch(listed, followers("next", [])).people, "followers:5")).toEqual(["11", "12"]);
  expect(at(mergeBatch(listed, followers(null, [])).people, "followers:5")).toEqual([]);
});

it("keeps notifications in X's order, newer on top, people by surface, and follows until X agrees", () => {
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

  // A follow X took holds against a page X answered before it, until a capture agrees.
  state = mergeBatch(
    askFollow(state, "5", true),
    batch("Other", [], { users: [user("5", "theo")] }),
  );
  expect(youFollow(state, state.users.get("5")!)).toBe(true);
  state = mergeBatch(
    state,
    batch("Other", [], { users: [{ ...user("5", "theo"), youFollow: true }] }),
  );
  expect(state.asked.size).toBe(0);
  // Only a capture of that person settles it: theo's unfollow holds while ann's agrees.
  state = askFollow(askFollow(state, "5", false), "1", true);
  state = mergeBatch(
    state,
    batch("Other", [], { users: [{ ...user("1", "ann"), youFollow: true }] }),
  );
  expect([...state.asked]).toEqual([["5", false]]);
  expect(askFollow(state, "5", null).asked.size).toBe(0);

  // A creator's Subscriptions hold when a later response names them without saying.
  state = mergeBatch(
    state,
    batch("UserByScreenName", [], { users: [{ ...user("5", "theo"), offersSubscriptions: true }] }),
  );
  state = mergeBatch(state, batch("Other", [], { users: [user("5", "theo")] }));
  expect(state.users.get("5")?.offersSubscriptions).toBe(true);
});

it("keeps X's Subs prompt per profile across X's next page, until X lists posts there", () => {
  const subs = profileSurface("subs", "50");
  const prompt = {
    header: "Unlock more with Subscriptions",
    body: "@maker has shared 12 Subscriber-only posts.",
    button: { text: "Subscribe", url: "https://x.com/maker/superfollows/subscribe" },
  };
  let state = mergeBatch(emptyEngine, batch("UserSuperFollowTweets", [], { key: "50", prompt }));
  // X's next page, asked with a cursor, lists nothing more.
  state = mergeBatch(state, batch("UserSuperFollowTweets", [], { key: "50", cursor: "c-Bottom" }));
  expect([state.prompts.get(subs), state.prompts.has(profileSurface("subs", "51"))]).toEqual([
    prompt,
    false,
  ]);
  // Once subscribed, X's first page lists their posts instead.
  state = mergeBatch(
    state,
    batch("UserSuperFollowTweets", [post("9", "2026-11-02T00:00:00.000Z")], { key: "50" }),
  );
  expect(state.prompts.has(subs)).toBe(false);
});

it("keeps the signed-in account's id when X's nav names it again without one, and what X's composer draws", () => {
  let state = mergeBatch(
    emptyEngine,
    batch("Viewer", [], { viewer: { userId: "7", handle: "siam", name: "Siam", avatarUrl: null } }),
  );
  // What X's composer draws stands until it draws otherwise; a page without one says nothing.
  state = mergeBatch(state, batch("ViewerFromNav", [], { formatting: false }));
  state = mergeBatch(state, batch("ViewerFromNav", []));
  expect(state.formatting).toBe(false);
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

it("shows what X's Edit profile saved on the user's header, their account and their posts, and nothing else", () => {
  const me: EngineUser = {
    userId: "1",
    handle: "ann",
    name: "Ann",
    avatarUrl: "https://pbs.twimg.com/old_normal.jpg",
    bannerUrl: "https://pbs.twimg.com/profile_banners/1/1",
    bio: "Old bio",
    location: "Dhaka",
    website: null,
    joinedAt: null,
    followers: 10,
    following: 1,
    posts: 1,
    verified: true,
    isProtected: false,
    youFollow: false,
    followsYou: false,
    pinnedPostId: null,
    verifiedType: null,
    avatarShape: "Circle",
    affiliate: null,
  };
  const viewer = { userId: null, handle: "ann", name: "Ann", avatarUrl: me.avatarUrl };
  let state = mergeBatch(
    emptyEngine,
    batch("UserByScreenName", [post("2", "2026-11-01T00:00:00Z")], { users: [me], viewer }),
  );
  const list = {
    listId: "9",
    name: "Builders",
    description: "",
    members: 1,
    followers: 0,
    isPrivate: false,
    bannerUrl: null,
    owner: { userId: "1", handle: "ann", name: "Ann", avatarUrl: me.avatarUrl },
    group: "Your Lists",
  };
  state = mergeBatch(state, batch("ListsManagementPageTimeline", [], { lists: [list] }));
  const save = (saved: Omit<EngineProfileSave, "userId" | "handle">) =>
    batch("UpdateProfile", [], { profileSaved: { userId: "1", handle: "ann", ...saved } });
  const site = { url: "https://ann.dev", display: "ann.dev" };
  const face = "https://pbs.twimg.com/new_normal.jpg";
  state = mergeBatch(state, save({ name: "Ann B", bio: "New bio", location: "", website: site }));
  state = mergeBatch(state, save({ avatarUrl: face }));
  state = mergeBatch(state, save({ bannerUrl: null }));
  expect(state.users.get("1")).toEqual({
    ...me,
    name: "Ann B",
    bio: "New bio",
    location: "",
    website: site,
    avatarUrl: face,
    bannerUrl: null,
  });
  expect(state.viewer).toEqual({ ...viewer, name: "Ann B", avatarUrl: face });
  expect([state.posts.get("2")?.avatarUrl, state.posts.get("2")?.author.name]).toEqual([
    face,
    "Ann B",
  ]);
  expect(state.xLists.get("9")?.owner).toEqual({ ...list.owner, name: "Ann B", avatarUrl: face });
});

it("keeps X's Post Analytics per post, as X last counted them", () => {
  const activity = (id: string, impressions: number) => ({
    ...batch("TweetActivityQuery", []),
    key: id,
    analytics: { Impressions: impressions, Engagements: 2 },
  });
  let state = mergeBatch(emptyEngine, activity("42", 90));
  state = mergeBatch(state, activity("43", 7));
  state = mergeBatch(state, activity("42", 120));
  state = mergeBatch(state, batch("HomeLatestTimeline", []));
  expect([...state.analytics]).toEqual([
    ["42", { Impressions: 120, Engagements: 2 }],
    ["43", { Impressions: 7, Engagements: 2 }],
  ]);
});

const overviewAnswer = (days: number, impressions: number) => ({
  ...batch("accountOverviewDailyQuery", []),
  key: `overview:${days}`,
  accountAnalytics: {
    kind: "overview" as const,
    days,
    from: "2026-10-27T00:00:00.000Z",
    daily: [{ Impressions: impressions }],
    previous: {},
    followers: 80,
    verifiedFollowers: null,
  },
});

it("keeps X's account analytics per range and X's claim; answers never pick the range", () => {
  let state = mergeBatch(emptyEngine, { ...batch("GetUserClaims", []), claims: [ANALYTICS_CLAIM] });
  state = mergeBatch(state, overviewAnswer(7, 10));
  state = mergeBatch(state, overviewAnswer(28, 90));
  state = mergeBatch(state, overviewAnswer(7, 12));
  state = mergeBatch(state, batch("HomeLatestTimeline", []));
  expect([
    state.accountAnalytics.access,
    analyticsRange(state.accountAnalytics, "overview"),
    [...state.accountAnalytics.answers.keys()],
  ]).toEqual([true, undefined, ["overview:7", "overview:28"]]);
  // X's claims every few minutes say the same, or that the account lost it.
  state = mergeBatch(state, { ...batch("GetUserClaims", []), claims: [] });
  expect(state.accountAnalytics.access).toBe(false);
});

it("replays the range a dev fixture says X's page shows; X's own answer says none", () => {
  const replayed = synth().accountAnalytics!.batches.reduce(mergeBatch, emptyEngine);
  expect([
    analyticsRange(replayed.accountAnalytics, "overview"),
    analyticsRange(replayed.accountAnalytics, "audience"),
    analyticsRange(mergeBatch(emptyEngine, overviewAnswer(7, 10)).accountAnalytics, "overview"),
  ]).toEqual([7, 7, undefined]);
});

it("draws the range X's page shows: an answer, late or not, only fills its own range's data", () => {
  const shown = (state: typeof emptyEngine) => analyticsRange(state.accountAnalytics, "overview");
  // 1Y, then 3M, each read off X's page once pressed; 1Y's answer comes late.
  let state = sawAnalyticsRange(emptyEngine, "overview", 7);
  state = pickAnalyticsRange(state, "overview", 365);
  state = endAnalyticsPick(sawAnalyticsRange(state, "overview", 365), "overview", 365);
  state = pickAnalyticsRange(state, "overview", 90);
  state = endAnalyticsPick(sawAnalyticsRange(state, "overview", 90), "overview", 90);
  state = mergeBatch(state, overviewAnswer(365, 4000));
  expect([shown(state), state.accountAnalytics.answers.has("overview:365")]).toEqual([90, true]);
});

it("shows a pick while its press is on its way, and the range X's page shows once it is over", () => {
  const shown = (state: typeof emptyEngine) => analyticsRange(state.accountAnalytics, "overview");
  let state = sawAnalyticsRange(emptyEngine, "overview", 7);
  state = pickAnalyticsRange(state, "overview", 28);
  state = pickAnalyticsRange(state, "overview", 90);
  // 4W's press ends after 3M was picked: 3M still shows; then its press fails, X still shows 7D.
  state = endAnalyticsPick(state, "overview", 28);
  expect(shown(state)).toBe(90);
  state = endAnalyticsPick(state, "overview", 90);
  expect(shown(state)).toBe(7);
  // Coming back, or X's page loading anew, on a range X kept: what X's page shows is drawn.
  state = sawAnalyticsRange(state, "overview", 28);
  expect(shown(state)).toBe(28);
});

it("reads access from X's page when X sends no claims, and lets claims say it when they come", () => {
  let state = sawAnalyticsPage(emptyEngine, true);
  expect(state.accountAnalytics.access).toBe(false);
  state = mergeBatch(state, { ...batch("GetUserClaims", []), claims: [ANALYTICS_CLAIM] });
  expect(sawAnalyticsPage(state, true).accountAnalytics.access).toBe(true);
  expect(sawAnalyticsPage(emptyEngine, false).accountAnalytics.access).toBe(true);
});

it("knows the day X's NBA schedule shows, an empty one too, and that X has not answered yet", () => {
  const game = {
    gameId: "51",
    status: "Final",
    startsAt: null,
    away: { abbreviation: "LAL", name: null, points: 1, timeouts: null, bonus: null },
    home: { abbreviation: "UTA", name: null, points: 0, timeouts: null, bonus: null },
    period: null,
    periodType: null,
    clock: null,
    halftime: false,
    lastPlay: null,
  };
  expect(emptyEngine.nbaDay).toBe(null);
  let state = mergeBatch(emptyEngine, { ...batch("NBASchedule", []), games: [game] });
  expect(state.nbaDay).toEqual(["51"]);
  state = mergeBatch(state, { ...batch("NBASchedule", []), games: [] });
  expect(state.nbaDay).toEqual([]);
});

it("keeps X's news stories per trend, and X's latest NBA standings and leaders", () => {
  const story = (id: string, title: string) => ({
    ...batch("AiTrendByRestId", []),
    key: id,
    story: { title, summary: "", updatedAt: null, disclaimer: null, timelines: [] },
  });
  let state = mergeBatch(emptyEngine, story("1", "First"));
  state = mergeBatch(state, story("2", "Second"));
  state = mergeBatch(state, story("1", "First, updated"));
  state = mergeBatch(state, {
    ...batch("NBAStandings", []),
    standings: [{ name: "East", divisions: [] }],
  });
  state = mergeBatch(state, { ...batch("NBALeaders", []), leaders: [] });
  state = mergeBatch(state, batch("HomeLatestTimeline", []));
  expect([
    [...state.stories].map(([id, s]) => [id, s.title]),
    state.standings,
    state.leaders,
  ]).toEqual([
    [
      ["1", "First, updated"],
      ["2", "Second"],
    ],
    [{ name: "East", divisions: [] }],
    [],
  ]);
});

it("keeps a post's context and ad mark per page, and lets a thread's newer replies in at once", () => {
  const reposted = {
    ...post("2", "2026-10-31T00:00:00Z"),
    context: { type: "Retweet", text: "Theo reposted", handle: "theo" },
  };
  const ad = { ...post("4", "2026-10-31T00:00:00Z"), isPromoted: true };
  let state = mergeBatch(emptyEngine, batch("HomeLatestTimeline", [reposted, ad]));
  // The posts' own thread pages send the same posts with no context and no ad mark.
  state = mergeBatch(
    state,
    batch("TweetDetail", [post("2", "2026-10-31T00:00:00Z")], { key: "2", top: "t" }),
  );
  state = mergeBatch(
    state,
    batch("TweetDetail", [post("4", "2026-10-31T00:00:00Z")], { key: "4" }),
  );
  expect(postOn(state, "following", "2")?.context?.text).toBe("Theo reposted");
  expect(postOn(state, "post:2", "2")?.context).toBeNull();
  expect([
    postOn(state, "following", "4")?.isPromoted,
    postOn(state, "post:4", "4")?.isPromoted,
  ]).toEqual([true, false]);
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
  state = mergeBatch(state, batch("TweetDetail", thread, { key: "1:Recency", order: ["1", "2"] }));
  state = mergeBatch(state, batch("HomeLatestTimeline", [post("3", "2026-10-30T02:00:00Z")]));
  const reply = { ...post("9", "2026-10-31T00:00:00Z"), replyToId: "1" };
  state = mergeBatch(state, batch("CreateTweet", [reply]));
  // Under the post in every reply order the thread was opened in.
  expect(at(state.lists, "post:1")).toEqual(["1", "9", "2"]);
  expect(at(state.lists, postSurface("1", "Recency"))).toEqual(["1", "9", "2"]);
  expect(at(state.lists, postSurface("1", "Likes"))).toEqual([]);
  expect(state.posts.get("1")?.metrics.replies).toBe(1);
  // A newer post waits behind the pill when the user posts: theirs stays on top after it.
  state = mergeBatch(
    state,
    batch("HomeLatestTimeline", [
      post("4", "2026-10-30T03:00:00Z"),
      post("3", "2026-10-30T02:00:00Z"),
    ]),
  );
  const quote = { ...post("10", "2026-10-31T01:00:00Z"), quotedId: "3" };
  state = mergeBatch(state, batch("CreateNoteTweet", [quote, post("3", "2026-10-30T02:00:00Z")]));
  expect(at(state.lists, "following")).toEqual(["10", "3"]);
  expect(at(state.lists, "profile:posts:1")).toEqual(["10"]);
  expect(at(showWaiting(state, "following").lists, "following")).toEqual(["10", "4", "3"]);
});

it("keeps dismissed trends hidden across stale captures of their tab, reconciles removal, and restores on Undo", () => {
  const trend = {
    name: "A trend",
    context: null,
    url: "https://x.com/search?q=trend",
    images: [],
    group: null,
  };
  const capture = (trends: EngineBatch["trends"], key = "news") =>
    batch("GenericTimelineById", [], { key, trends });
  let state = mergeBatch(emptyEngine, capture([trend]));
  state = hideTrend(state, "explore:news", trend, true, 0);
  state = mergeBatch(state, capture([trend]));
  expect(at(state.hiddenTrends, "explore:news")).toEqual([trend.name]);
  state = mergeBatch(state, capture([], "trending"));
  expect(at(state.hiddenTrends, "explore:news")).toEqual([trend.name]);
  state = mergeBatch(state, capture([]));
  expect(at(state.hiddenTrends, "explore:news")).toEqual([]);
  expect(at(state.trends, "explore:news")).toEqual([]);
  state = hideTrend(state, "explore:news", trend, false, 0);
  expect(at(state.trends, "explore:news")).toEqual([trend]);
  expect(at(state.trends, "explore:trending")).toEqual([]);
});

it("lists X's GIF search per query in X's order, joins its next page, and starts a query over on its first", () => {
  const gif = (id: string): EngineGif => ({
    id,
    altText: null,
    url: `https://media1.giphy.com/media/${id}/200_d.gif`,
    stillUrl: null,
    width: 200,
    height: 150,
    provider: "GIPHY",
  });
  const search = (
    query: string,
    gifs: ReadonlyArray<EngineGif>,
    extra: Partial<EngineBatch> = {},
  ) => batch("GifSearch", [], { key: `gifs:${query}`, gifs, ...extra });
  const ids = (state: EngineState, query: string) =>
    at(state.gifs, gifSurface(query)).map((g) => g.id);
  let state = mergeBatch(emptyEngine, search("cat", [gif("1"), gif("2")], { bottom: "go50c50" }));
  state = mergeBatch(state, search("dog", [gif("9")]));
  state = mergeBatch(state, search("cat", [gif("2"), gif("3")], { cursor: "go50c50" }));
  expect([ids(state, "cat"), ids(state, "dog")]).toEqual([["1", "2", "3"], ["9"]]);
  state = mergeBatch(state, search("cat", [gif("4")]));
  expect(ids(state, "cat")).toEqual(["4"]);
  // X found nothing: the query is answered, with nothing listed.
  state = mergeBatch(state, search("zzz", []));
  expect([ids(state, "zzz"), state.cursors[gifSurface("zzz")]]).toEqual([
    [],
    { top: null, bottom: null },
  ]);
});

it("keeps an Article's body when a timeline sends its post again with the card only", () => {
  const body = {
    postId: "5",
    blocks: [
      {
        key: "a",
        type: "unstyled",
        text: "Hello",
        styles: [],
        links: [],
        images: [],
        markdown: null,
      },
    ],
  };
  const reader = mergeBatch(
    emptyEngine,
    batch("TweetResultByRestId", [post("5", "2026-10-31T01:00:00Z")], { articles: [body] }),
  );
  const after = mergeBatch(reader, batch("HomeTimeline", [post("5", "2026-10-31T01:00:00Z")]));
  expect(after.articles.get("5")).toEqual(body);
});

it("keeps what each response said of a game, a team's schedule, each game's day, and a game's tabs apart", () => {
  const team = (abbreviation: string | null, points: number | null) => ({
    abbreviation,
    name: abbreviation,
    points,
    timeouts: null,
    bonus: null,
  });
  const game = (gameId: string, extra: Partial<EngineGame> = {}): EngineGame => ({
    gameId,
    status: "IN_PROGRESS",
    startsAt: "2026-11-02T02:00:00.000Z",
    away: team("TOR", 82),
    home: team("LAL", 104),
    period: 3,
    periodType: "QUARTER",
    clock: "00:00",
    halftime: false,
    lastPlay: { kind: "REBOUND", description: "Raptors offensive rebound" },
    ...extra,
  });
  let state = mergeBatch(
    emptyEngine,
    batch("UserSportsProfile", [], { key: "20", games: [game("41"), game("40")] }),
  );
  state = mergeBatch(state, batch("NBASchedule", [], { games: [game("42"), game("41")] }));
  // X's live re-poll names the new score only.
  state = mergeBatch(
    state,
    batch("NBALiveGame", [], {
      key: "41",
      games: [
        game("41", {
          away: { ...team(null, 85), timeouts: 2, bonus: true },
          home: team(null, null),
          status: null,
          startsAt: null,
          period: null,
          periodType: null,
          clock: null,
          halftime: null,
          lastPlay: null,
        }),
      ],
    }),
  );
  expect(state.games.get("41")).toEqual(
    game("41", { away: { ...team("TOR", 85), timeouts: 2, bonus: true } }),
  );
  expect(state.schedules.get("20")).toEqual(["41", "40"]);
  expect([state.gameDays.get("41"), state.gameDays.get("40")]).toEqual([["42", "41"], undefined]);

  const top = batch("SportsGameTopTimeline", [post("7", "2026-11-02T03:00:00.000Z")], {
    key: "41",
  });
  const latest = {
    ...top,
    op: "SportsGameLatestTimeline",
    posts: [post("8", "2026-11-02T03:05:00.000Z")],
  };
  expect([surfacesOf(top), surfacesOf(latest)]).toEqual([
    [gameSurface("41", "Top")],
    [gameSurface("41", "Latest")],
  ]);
  state = [top, latest].reduce(mergeBatch, state);
  expect([
    at(state.lists, gameSurface("41", "Top")),
    at(state.lists, gameSurface("41", "Latest")),
  ]).toEqual([["7"], ["8"]]);
});

it("keeps X's bookmark folders in X's order as X's dialogs and rows change them, each folder's posts under it", () => {
  const folder = (folderId: string, name: string) => ({ folderId, name, imageUrl: null });
  const change = (
    bookmarkFolders: NonNullable<EngineBatch["bookmarkFolders"]>,
    cursor: string | null = null,
  ) => batch("Folders", [], { bookmarkFolders, cursor });
  // A change before X listed the folders says nothing of the rest: still unknown.
  expect(
    mergeBatch(emptyEngine, change({ kind: "saved", folder: folder("803", "Recipes") }))
      .bookmarkFolders,
  ).toBeNull();

  const ids = (s: EngineState) => s.bookmarkFolders?.map((f) => `${f.folderId} ${f.name}`);
  let state = [
    change({
      kind: "list",
      folders: [folder("801", "Reading"), { ...folder("802", "Ideas"), imageUrl: "pic" }],
    }),
    change({ kind: "list", folders: [folder("804", "Later")] }, "next"),
    batch("GetUserClaims", [], { claims: ["subscriptions_feature_1002"] }),
  ].reduce(mergeBatch, emptyEngine);
  expect([ids(state), [...(state.claims ?? [])]]).toEqual([
    ["801 Reading", "802 Ideas", "804 Later"],
    ["subscriptions_feature_1002"],
  ]);
  // X lists a folder it created, renamed, or put a post in first; a deleted one goes.
  state = [
    change({ kind: "saved", folder: folder("803", "Recipes") }),
    change({ kind: "saved", folder: folder("802", "Ideas 2") }),
    change({ kind: "deleted", folderId: "804" }),
  ].reduce(mergeBatch, state);
  expect(ids(state)).toEqual(["802 Ideas 2", "803 Recipes", "801 Reading"]);
  // A rename keeps the picture X's answer did not repeat.
  expect(state.bookmarkFolders?.[0]?.imageUrl).toBe("pic");

  const [a, b, c] = ["1", "2", "3"].map((id) => post(id, `2026-10-2${id}T10:00:00.000Z`));
  expect(surfacesOf({ op: "BookmarkFolderTimeline", key: "801" })).toEqual(["bookmarkFolder:801"]);
  state = [
    batch("BookmarkFolderTimeline", [a!, b!], { key: "801", order: ["1", "2"] }),
    batch("HomeTimeline", [c!], { order: ["3"] }),
    change({ kind: "post", folderId: "801", postId: "3", added: true }),
    change({ kind: "post", folderId: "801", postId: "1", added: false }),
    // A folder never opened here waits for X's own first page of it; one X answered as empty
    // takes the post, as X's page does without fetching.
    change({ kind: "post", folderId: "803", postId: "3", added: true }),
    batch("BookmarkFolderTimeline", [], { key: "802", top: "t" }),
    change({ kind: "post", folderId: "802", postId: "3", added: true }),
  ].reduce(mergeBatch, state);
  expect(["801", "803", "802"].map((id) => at(state.lists, `bookmarkFolder:${id}`))).toEqual([
    ["3", "2"],
    [],
    ["3"],
  ]);
  expect(ids(state)?.slice(0, 3)).toEqual(["802 Ideas 2", "803 Recipes", "801 Reading"]);
  // X's next claims, after the plan lapsed, hold no folders.
  expect(mergeBatch(state, batch("GetUserClaims", [], { claims: [] })).claims?.size).toBe(0);
});

it("keeps X's Radar: its list in X's order, a query's days as X finishes counting them, and its posts as X ranks them now", () => {
  const query = (id: string) => ({
    id,
    title: "",
    query: `q${id}`,
    createdAt: "2026-10-28T09:00:00.000Z",
    preview: [],
  });
  const day = (d: string, count: number | null) => ({ at: `2026-11-0${d}T00:00:00.000Z`, count });
  const listed = mergeBatch(
    emptyEngine,
    batch("insightsListContextQuery", [], { key: "radar", radarQueries: [query("2"), query("1")] }),
  );
  // X still counted the oldest day; its next answer for those days fills it in.
  const counted = [
    batch("insightsConfigQuery", [], { radarLimit: 3 }),
    batch("usePostCountQuery", [], { key: "1", radarCounts: [day("1", null), day("2", 7)] }),
    batch("usePostCountQuery", [], { key: "1", radarCounts: [day("1", 9), day("2", null)] }),
  ].reduce(mergeBatch, listed);
  // A day later X's answer starts from a newer day.
  const nextDay = mergeBatch(
    counted,
    batch("usePostCountQuery", [], { key: "1", radarCounts: [day("2", 8), day("3", 2)] }),
  );
  const deleted = mergeBatch(
    counted,
    batch("deleteInsightButtonMutation", [], { radarDeleted: "2" }),
  );
  expect([
    deleted.radar.list,
    counted.radar.list,
    counted.radar.limit,
    counted.radar.counts.get("1"),
    nextDay.radar.counts.get("1"),
  ]).toEqual([["1"], ["2", "1"], 3, [day("1", 9), day("2", 7)], [day("2", 8), day("3", 2)]]);

  // A new visit's first page is X's ranking now, not one behind a pill.
  const surface = radarSurface("q1");
  const first = mergeBatch(
    emptyEngine,
    batch("postListQuery", [post("5", "2026-11-01T00:00:00Z")], { key: "radar:Top:q1" }),
  );
  const again = mergeBatch(
    first,
    batch("postListQuery", [post("6", "2026-11-02T00:00:00Z"), post("5", "2026-11-01T00:00:00Z")], {
      key: "radar:Top:q1",
    }),
  );
  const liked = { ...post("7", "2026-11-01T00:00:00Z"), liked: true };
  const home = mergeBatch(emptyEngine, batch("HomeTimeline", [liked]));
  const radar = mergeBatch(
    home,
    batch("postListQuery", [post("7", "2026-11-01T00:00:00Z")], { key: "radar:Top:q1" }),
  );
  expect([
    at(first.lists, surface),
    at(again.lists, surface),
    radar.posts.get("7")?.liked,
    at(radar.lists, surface),
  ]).toEqual([["5"], ["6", "5"], true, ["7"]]);
});

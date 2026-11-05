import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import {
  renderEngineBatch,
  renderKnownFollowers,
  renderSpaceCaptions,
} from "../../../desktop/src/xSession/engineBatch.ts";
import { route } from "./pages.ts";
import { createMockState } from "./state.ts";

/**
 * The x.com pages that show each made-up fixture, as Xtend's screens move the engine to them, and
 * the Home tab picked there.
 */
const PAGES: ReadonlyArray<readonly [path: string, tab?: string]> = [
  ["/home", "following"],
  ["/home", "forYou"],
  ["/noor_lind/status/700000000016"],
  ["/theo_varga/article/700000000980"],
  ["/mira_brandt"],
  ["/notifications"],
  ["/notifications/mentions"],
  ["/search?q=design%20system&src=typed_query"],
  ["/search?q=design%20system&src=typed_query&f=user"],
  ["/i/bookmarks"],
  ["/i/bookmarks/800000000001"],
  ["/i/bookmarks/800000000002"],
  ["/explore"],
  ["/you/lists"],
  ["/i/lists/600000000001"],
  ["/i/connect_people"],
  ["/i/connect_people?is_creator_only=true"],
  ["/you/communities"],
  ["/you/communities/explore"],
  ["/i/communities/600000000103", "Top"],
  ["/i/communities/600000000103", "Latest"],
  ["/i/communities/600000000103", "Media"],
  ["/i/communities/600000000103/about"],
  ["/i/communities/suggested?q=founders"],
  ["/i/communities/top?q=founders"],
  ["/i/communities/latest?q=founders"],
  ["/you"],
  ["/you/status/700000000027/analytics"],
  ["/yuki_mensah20"],
  ["/i/nba/game/900000500004", "Top"],
  ["/i/nba/game/900000500004", "Latest"],
  ["/i/account_analytics"],
  ["/i/account_analytics", "4W"],
  ["/i/account_analytics/content"],
  ["/i/account_analytics/video"],
  ["/i/account_analytics/audience"],
  ["/i/trending/900000600001"],
  ["/i/trending/900000600001?timeline=story-latest"],
  ["/i/nba/standings"],
  ["/i/nba/players"],
  ["/sam_sato/status/700000000034"],
  ["/ines_berg/status/700000000035"],
  ["/i/spaces/900000700001/peek"],
  ["/i/spaces/900000700003/peek"],
  ["/i/account_analytics/spaces"],
  ["/i/account_analytics/spaces/900000700003"],
];

it("answers every request X's pages make with the batch the made-up fixtures hold, as the capture reads it", () => {
  const state = createMockState();
  const read: Array<EngineBatch> = [];
  for (const [path, tab = "forYou"] of PAGES)
    for (const { op, variables } of [
      { op: "Viewer", variables: {} },
      { op: "GetUserClaims", variables: {} },
      ...route(state, path, tab).requests,
    ])
      // A response round-trips through JSON on its way to the capture.
      read.push(
        renderEngineBatch(op, variables, JSON.parse(JSON.stringify(state.respond(op, variables)))),
      );

  // A recording's captions come from X's recording chat, JSON lines no GraphQL call answers.
  const fixtures = Object.values(state.fixtures())
    .flatMap((f) => f.batches)
    .filter((b) => b.op !== "LiveChatReplay");
  for (const want of fixtures) {
    const got = read.find((b) => b.op === want.op && b.key === want.key);
    expect(got, `${want.op} ${want.key}`).toBeDefined();
    // The people a screen needs from this response: a profile's own header, everyone a people
    // timeline lists, every post's author. Each comes as the fixture has them.
    const needed = [
      ...(want.op === "UserByScreenName" ? want.users.map((u) => u.userId) : []),
      ...want.people,
      ...want.posts.map((p) => p.author.userId),
    ];
    expect(got!.users.map((u) => u.userId)).toEqual(expect.arrayContaining(needed));
    const users = new Map(want.users.map((u) => [u.userId, u]));
    for (const u of got!.users) expect(u).toEqual(users.get(u.userId));
    // The analytics range a fixture shows is set by dev replay only; X's answers never carry it.
    expect({ ...got!, users: [] }).toEqual({ ...want, users: [], analyticsShown: undefined });
  }
  // For you's Who to follow, in X's module shape, reads back where the fixture puts it.
  const forYou = read.find((b) => b.op === "HomeTimeline" && b.key === null)!;
  expect(forYou.modules.map((m) => [m.title, forYou.order.indexOf(m.id)])).toEqual([
    ["Who to follow", 2],
  ]);
  // Explore's For you pages on with plain posts, keyed to its tab like its first page.
  const explore = read.find((b) => b.op === "ExplorePage")!;
  const variables = { cursor: explore.bottom };
  const next = renderEngineBatch(
    "ExplorePage",
    variables,
    JSON.parse(JSON.stringify(state.respond("ExplorePage", variables))),
  );
  expect([next.key, next.cursor, next.order, next.modules]).toEqual([
    explore.key,
    explore.bottom,
    state.exploreNextIds(),
    [],
  ]);

  // A creator's header says they offer Subscriptions, and their Subs is X's prompt to a
  // non-subscriber; both read back as mock X holds them.
  const creator = state.user(state.fixture("ConnectTabTimeline", "connect:creators")!.people[0]!)!;
  const roundTrip = (op: string, variables: Record<string, unknown>) =>
    renderEngineBatch(op, variables, JSON.parse(JSON.stringify(state.respond(op, variables))));
  expect(
    roundTrip("UserByScreenName", { screen_name: creator.handle }).users[0]!.offersSubscriptions,
  ).toBe(true);
  const subs = { userId: creator.userId, count: 20 };
  expect(roundTrip("UserSuperFollowTweets", subs).prompt).toEqual(
    state.batchFor("UserSuperFollowTweets", subs)!.prompt,
  );

  // X's REST count of followers you know, for someone with them and someone with none.
  const known = (handle: string) => {
    const id = state.people.find((u) => u.handle === handle)!.userId;
    const url = `https://x.com/i/api/1.1/friends/following/list.json?user_id=${id}&count=3`;
    return renderKnownFollowers(url, JSON.parse(JSON.stringify(state.knownFollowers(id))))
      ?.knownFollowers;
  };
  expect([known("sam_sato"), known("noor_lind")]).toEqual([5, 0]);

  // X's recording chat for a Space reads back as the captions the fixture holds.
  const chat = state.fixture("LiveChatReplay", "900000700003")!;
  expect(
    renderSpaceCaptions(
      "https://x.com/live-chat?broadcastId=900000700003&sessionId=s1&replay=1&cursor=0",
      state.spaces.replayChat("900000700003"),
    )?.spaceCaptions,
  ).toEqual(chat.spaceCaptions);
});

it("answers X's GIF search page by page, read back as the batch mock X draws its tiles from", () => {
  const state = createMockState();
  for (const variables of [{ query: "cat" }, { query: "cat", cursor: "go50c50" }]) {
    const want = state.batchFor("GifSearch", variables)!;
    const got = renderEngineBatch(
      "GifSearch",
      variables,
      JSON.parse(JSON.stringify(state.respond("GifSearch", variables))),
    );
    expect([got.key, got.cursor, got.bottom, got.gifs]).toEqual([
      want.key,
      want.cursor,
      want.bottom,
      want.gifs,
    ]);
  }
});

it("answers X's Radar only with Premium, in X's Relay shapes, as the capture reads them back", () => {
  const state = createMockState();
  // X's upsell for an account without Premium makes no Radar call.
  expect(route(state, "/i/radar", "forYou").requests).toEqual([]);
  state.radar.premium = true;
  const ops = new Set<string>();
  const posts = (path: string) =>
    route(state, path, "forYou").requests.flatMap(
      (q) => state.batchFor(q.op, q.variables)?.posts ?? [],
    );
  // Each query finds posts, so the round trip reads some.
  expect([posts("/i/radar/1801").length > 0, posts("/i/radar/1802").length > 0]).toEqual([
    true,
    true,
  ]);
  for (const path of ["/i/radar", "/i/radar/1801", "/i/radar/new"])
    for (const { op, variables } of route(state, path, "forYou").requests) {
      ops.add(op);
      const want = state.batchFor(op, variables)!;
      const got = renderEngineBatch(
        op,
        variables,
        JSON.parse(JSON.stringify(state.respond(op, variables))),
      );
      const read = (b: EngineBatch) => [
        b.key,
        b.radarQueries,
        b.radarLimit,
        b.radarCounts,
        b.posts.map((p) => [p.postId, p.text, p.author.handle, p.metrics]),
      ];
      expect(read(got), `${path} ${op}`).toEqual(read(want));
    }
  expect([...ops].toSorted()).toEqual([
    "insightProviderGetQuery",
    "insightsConfigQuery",
    "insightsListContextQuery",
    "postListQuery",
    "usePostCountQuery",
  ]);
});

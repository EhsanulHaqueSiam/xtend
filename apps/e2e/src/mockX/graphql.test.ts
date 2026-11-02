import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import {
  renderEngineBatch,
  renderKnownFollowers,
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
  ["/explore"],
  ["/you/lists"],
  ["/i/lists/600000000001"],
  ["/i/connect_people"],
  ["/i/connect_people?is_creator_only=true"],
  ["/you/communities"],
  ["/you/communities/explore"],
  ["/i/communities/600000000103"],
  ["/i/communities/600000000103/latest"],
  ["/i/communities/600000000103/media"],
  ["/i/communities/600000000103/about"],
  ["/i/communities/suggested?q=founders"],
  ["/i/communities/top?q=founders"],
  ["/i/communities/latest?q=founders"],
  ["/you"],
  ["/you/status/700000000027/analytics"],
  ["/yuki_mensah20"],
  ["/i/nba/game/900000500004", "Top"],
  ["/i/nba/game/900000500004", "Latest"],
];

it("answers every request X's pages make with the batch the made-up fixtures hold, as the capture reads it", () => {
  const state = createMockState();
  const read: Array<EngineBatch> = [];
  for (const [path, tab = "forYou"] of PAGES)
    for (const { op, variables } of [
      { op: "Viewer", variables: {} },
      ...route(state, path, tab).requests,
    ])
      // A response round-trips through JSON on its way to the capture.
      read.push(
        renderEngineBatch(op, variables, JSON.parse(JSON.stringify(state.respond(op, variables)))),
      );

  const fixtures = Object.values(state.fixtures()).flatMap((f) => f.batches);
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
    expect({ ...got!, users: [] }).toEqual({ ...want, users: [] });
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

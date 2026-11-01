import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { renderEngineBatch } from "../../../desktop/src/xSession/engineBatch.ts";
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
});

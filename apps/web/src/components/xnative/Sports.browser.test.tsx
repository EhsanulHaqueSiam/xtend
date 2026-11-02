import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { EngineBatch, EngineGame, EnginePost } from "@xtend/contracts";
import { useEffect } from "react";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { Route as GameRoute } from "../../routes/nba.game.$id";
import { markXReady, registerXWebview, xGo, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";
import { TeamSchedule } from "./Sports";

const batch = (op: string, extra: Partial<EngineBatch>): EngineBatch => ({
  op,
  key: null,
  cursor: null,
  top: null,
  bottom: null,
  posts: [],
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

const team = (abbreviation: string, points: number | null, extra = {}) => ({
  abbreviation,
  name: `${abbreviation} team`,
  points,
  timeouts: null,
  bonus: null,
  ...extra,
});
const game = (gameId: string, extra: Partial<EngineGame> = {}): EngineGame => ({
  gameId,
  status: "COMPLETED",
  startsAt: "2026-11-01T12:00:00.000Z",
  away: team("LAL", 132),
  home: team("UTA", 123),
  period: null,
  periodType: null,
  clock: null,
  halftime: false,
  lastPlay: null,
  ...extra,
});
const live = game("52", {
  status: "IN_PROGRESS",
  away: team("TOR", 82, { timeouts: 3, bonus: true }),
  home: team("LAL", 104, { timeouts: 5, bonus: false }),
  period: 3,
  periodType: "QUARTER",
  clock: "00:00",
  lastPlay: { kind: "REBOUND", description: "Raptors offensive rebound" },
});
// Midday UTC: the same day wherever the test runs.
const later = game("53", {
  status: "SCHEDULED",
  startsAt: "2026-11-03T12:00:00.000Z",
  away: team("MIA", null),
  home: team("LAL", null),
});

const post = (postId: string, text: string): EnginePost => ({
  postId,
  author: { userId: "1", handle: "fan", name: "Fan", followers: 10, verified: false },
  text,
  createdAt: "2026-11-02T03:00:00.000Z",
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 10, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  avatarUrl: null,
  media: [],
  quotedId: null,
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

it("draws a team's schedule in X's card forms, and nothing for an account X gives none", async () => {
  const bridge = installFakeBridge();
  await using screen = await render(
    <>
      <EngineSync />
      <TeamSchedule userId="20" />
      <TeamSchedule userId="21" />
    </>,
    { service: {} },
  );
  bridge.emitEngine(batch("UserSportsProfile", { key: "20", games: [game("51"), live, later] }));
  const cards = screen.getByRole("link");
  await expect
    .poll(() => cards.elements().map((c) => c.textContent))
    .toEqual([
      "FinalLAL132UTA123",
      "LIVEQ3 00:00TOR82LAL104",
      expect.stringMatching(/^Nov 3\d{1,2}:\d{2}\s[AP]MMIALAL$/),
    ]);
  expect(cards.elements().map((c) => c.getAttribute("href"))).toEqual([
    "/nba/game/51",
    "/nba/game/52",
    "/nba/game/53",
  ]);
  // One carousel: the other account has no schedule.
  expect(screen.getByRole("region", { name: "Schedule" }).elements()).toHaveLength(1);
});

it("opens a game with the day's strip and X's header, and Latest presses X's own tab for its own list", async () => {
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  // X's page follows X's router, as the engine's moves drive it.
  let url = "https://x.com/home";
  registerXWebview({
    executeJavaScript: (code: string) => {
      scripts.push(code);
      const to = /pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
      if (to !== undefined) url = `https://x.com${to}`;
      return Promise.resolve(true);
    },
    getURL: () => url,
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  // The real screen, under a router that holds its route.
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/nba/game/$id",
        validateSearch: GameRoute.options.validateSearch,
        component: GameRoute.options.component!,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/nba/game/52"] }),
  });
  try {
    await using screen = await render(
      <div style={{ height: 800, display: "flex" }}>
        <EngineSync />
        <RouterProvider router={router} />
      </div>,
      { router: false, service: {} },
    );
    // X answers for the game once the screen has moved the engine there.
    await expect.poll(() => url).toBe("https://x.com/i/nba/game/52");
    bridge.emitEngine(batch("NBASchedule", { games: [game("51"), live] }));
    bridge.emitEngine(batch("NBAGameHydrate", { key: "52", games: [live] }));
    bridge.emitEngine(
      batch("SportsGameTopTimeline", { key: "52", posts: [post("61", "Top take")], order: ["61"] }),
    );
    const strip = screen.getByRole("navigation", { name: "Today's games" });
    await expect.element(strip.getByRole("link", { name: "LAL Final 132-123 UTA" })).toBeVisible();
    await expect
      .element(strip.getByRole("link", { name: "TOR Q3 LAL" }))
      .toHaveAttribute("aria-current", "page");
    const header = screen.getByRole("heading", { name: "TOR @ LAL" });
    await expect.element(header).toBeVisible();
    await expect.element(screen.getByText("3 of 7 timeouts remaining · Bonus")).toBeVisible();
    await expect.element(screen.getByText("5 of 7 timeouts remaining")).toBeVisible();
    await expect.element(screen.getByText("Raptors offensive rebound")).toBeVisible();
    await expect.element(screen.getByText("Top take")).toBeVisible();

    await screen.getByRole("tab", { name: "Latest" }).click();
    // X's tab is pressed in place on the game's own page.
    await expect
      .poll(() => scripts.some((s) => s.includes("/i/nba/game/52") && s.includes('"Latest"')))
      .toBe(true);
    await expect.element(screen.getByText("Loading the game from X.")).toBeVisible();
    bridge.emitEngine(
      batch("SportsGameLatestTimeline", {
        key: "52",
        posts: [post("62", "Latest take")],
        order: ["62"],
      }),
    );
    await expect.element(screen.getByText("Latest take")).toBeVisible();
    expect(screen.getByText("Top take").elements()).toHaveLength(0);
  } finally {
    registerXWebview(null);
  }
});

it("takes the engine off a game the user left for a screen that moves it nowhere, and leaves it to one that does", async () => {
  installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(true)),
    getURL: () => "https://x.com/i/nba/game/52",
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  const panel = localStorage.getItem("xtend:x-panel-open");
  localStorage.setItem("xtend:x-panel-open", "false");
  // A screen that moves the engine itself, as Xtend's X screens do, and one that does not.
  function Explore() {
    useEffect(() => void xGo("https://x.com/explore"), []);
    return null;
  }
  const root = createRootRoute();
  const route = (path: string, component: () => null) =>
    createRoute({ getParentRoute: () => root, path, component });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/nba/game/$id",
        validateSearch: GameRoute.options.validateSearch,
        component: GameRoute.options.component!,
      }),
      route("/explore", Explore),
      route("/settings", () => null),
    ]),
    history: createMemoryHistory({ initialEntries: ["/nba/game/52"] }),
  });
  const parked = () => scripts.some((s) => s.includes('pushState(null, "", "/home")'));
  try {
    await using screen = await render(<RouterProvider router={router} />, {
      router: false,
      service: {},
    });
    const game = screen.getByRole("heading", { name: "Game" });
    await expect.element(game).toBeVisible();
    router.history.push("/explore");
    await expect.poll(() => scripts.some((s) => s.includes('"/explore"'))).toBe(true);
    expect(parked()).toBe(false);
    await router.navigate({ to: "/nba/game/$id", params: { id: "52" } });
    await expect.element(game).toBeVisible();
    router.history.push("/settings");
    await expect.poll(parked).toBe(true);
  } finally {
    registerXWebview(null);
    if (panel === null) localStorage.removeItem("xtend:x-panel-open");
    else localStorage.setItem("xtend:x-panel-open", panel);
  }
});

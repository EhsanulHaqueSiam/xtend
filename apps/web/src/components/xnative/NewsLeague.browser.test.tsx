import {
  type AnyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, it, onTestFinished } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { Route as LeagueRoute } from "../../routes/nba.index";
import { Route as StoryRoute } from "../../routes/trending.$id";
import { emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "./EngineSync";
import { synth } from "./engineFixtures";

const fixtures = synth();
const answer = (op: string, key: string | null = null) =>
  Object.values(fixtures)
    .flatMap((f) => f.batches)
    .find((b) => b.op === op && b.key === key)!;

/** One route's real screen at `path` on a fresh store, the engine a fake webview whose URL moves. */
async function open(route: AnyRoute, path: string, start: string) {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  let url = "https://x.com/home";
  registerXWebview({
    executeJavaScript: (code: string) => {
      const pushed = /history\.pushState\(null, "", "([^"]+)"\)/.exec(code)?.[1];
      if (pushed !== undefined) url = `https://x.com${JSON.parse(`"${pushed}"`)}`;
      return Promise.resolve(true);
    },
    getURL: () => url,
    loadURL: () => Promise.resolve(),
  } as unknown as XWebview);
  markXReady();
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path,
        validateSearch: route.options.validateSearch,
        component: route.options.component!,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/analyze",
        component: () => <p>Analyze</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [start] }),
  });
  const screen = await render(
    <div style={{ height: 800, display: "flex" }}>
      <EngineSync />
      <RouterProvider router={router} />
    </div>,
    { router: false, service: {} },
  );
  return {
    bridge,
    screen,
    router,
    url: () => url,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      registerXWebview(null);
    },
  };
}

it("draws X's news story, and a tab opens X's own page for it with its posts", async () => {
  const id = "900000600001";
  await using x = await open(StoryRoute, "/trending/$id", `/trending/${id}`);
  await expect.poll(x.url).toBe(`https://x.com/i/trending/${id}`);
  x.bridge.emitEngine(answer("AiTrendByRestId", id));
  x.bridge.emitEngine(answer("GenericTimelineById", "story-top"));
  const story = answer("AiTrendByRestId", id).story!;
  await expect.element(x.screen.getByRole("heading", { name: story.title })).toBeVisible();
  await expect.element(x.screen.getByText(story.summary)).toBeVisible();
  await expect.element(x.screen.getByText(story.disclaimer!)).toBeVisible();
  const top = answer("GenericTimelineById", "story-top").posts[0]!;
  await expect.element(x.screen.getByText(top.text)).toBeVisible();

  await x.screen.getByRole("tab", { name: "Latest" }).click();
  await expect.poll(x.url).toBe(`https://x.com/i/trending/${id}?timeline=story-latest`);
  x.bridge.emitEngine(answer("GenericTimelineById", "story-latest"));
  const latest = answer("GenericTimelineById", "story-latest").posts[0]!;
  await expect.element(x.screen.getByText(latest.text)).toBeVisible();
  await expect.element(x.screen.getByText(top.text)).not.toBeInTheDocument();
});

it("draws X's own caveat under a story X names none for, and takes the engine off it on leaving", async () => {
  const id = "900000600001";
  // X's panel closed: nothing shows X's story once the screen is left.
  const panel = localStorage.getItem("xtend:x-panel-open");
  localStorage.setItem("xtend:x-panel-open", "false");
  onTestFinished(() =>
    panel === null
      ? localStorage.removeItem("xtend:x-panel-open")
      : localStorage.setItem("xtend:x-panel-open", panel),
  );
  await using x = await open(StoryRoute, "/trending/$id", `/trending/${id}`);
  await expect.poll(x.url).toBe(`https://x.com/i/trending/${id}`);
  const told = answer("AiTrendByRestId", id);
  x.bridge.emitEngine({ ...told, story: { ...told.story!, disclaimer: "" } });
  await expect
    .element(
      x.screen.getByText(
        "This story is a summary of posts on X made by grok. Story will evolve over time.",
      ),
    )
    .toBeVisible();
  // A screen that moves the engine nowhere: X's story stops polling there.
  await x.router.navigate({ to: "/analyze" });
  await expect.element(x.screen.getByText("Analyze")).toBeVisible();
  await expect.poll(x.url).toBe("https://x.com/home");
});

it("draws X's league page: the day's games, standings by conference, and each stat's leaders", async () => {
  await using x = await open(LeagueRoute, "/nba/", "/nba?tab=standings");
  await expect.poll(x.url).toBe("https://x.com/i/nba/standings");
  x.bridge.emitEngine(answer("NBAStandings"));
  const rows = () =>
    [...x.screen.container.querySelectorAll('[data-x="standings"] tbody tr')].map(
      (r) => r.querySelector("td")?.textContent,
    );
  await expect.poll(rows).toEqual(["1HBH", "2BAY"]);
  // X's win share without its leading zero, and its last ten as a record.
  expect(
    [...x.screen.container.querySelectorAll('[data-x="standings"] tbody tr')][0]!.textContent,
  ).toContain(".714");
  await x.screen.getByRole("tab", { name: "West" }).click();
  await expect.poll(rows).toEqual(["1RVR", "2DES"]);

  await x.screen.getByRole("tab", { name: "Stats" }).click();
  await expect.poll(x.url).toBe("https://x.com/i/nba/players");
  x.bridge.emitEngine(answer("NBALeaders"));
  await expect.element(x.screen.getByText("M. Okafor")).toBeVisible();
  await x.screen.getByRole("button", { name: "Points Per Game" }).click();
  await page.getByRole("menuitem", { name: "Rebounds Per Game" }).click();
  await expect.element(x.screen.getByText("K. Mensah")).toBeVisible();

  await x.screen.getByRole("tab", { name: "Schedule" }).click();
  await expect.poll(x.url).toBe("https://x.com/i/nba/games");
  // A day X answers with no games says so, rather than waiting.
  x.bridge.emitEngine({ ...answer("NBASchedule"), games: [] });
  await expect.element(x.screen.getByText("No games on this day.")).toBeVisible();
  x.bridge.emitEngine(answer("NBASchedule"));
  await expect
    .poll(
      () =>
        x.screen.container.querySelectorAll('[data-x="league-games"] [data-x="game-card"]').length,
    )
    .toBe(answer("NBASchedule").games!.length);
});

import type { EngineBatch, EngineRadarQuery } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { settings } from "../../../test/fixtures";
import { render } from "../../../test/render";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { synth } from "../xnative/engineFixtures";
import { Toasts } from "../ui/toast";
import { RadarTab } from "./RadarTab";

const answer = (op: string, extra: Partial<EngineBatch>): EngineBatch => ({
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
const query = (id: string, title: string, q: string): EngineRadarQuery => ({
  id,
  title,
  query: q,
  createdAt: "2026-10-28T09:00:00.000Z",
  preview: [],
});
const service = {
  "library.savedIds": () => Effect.succeed([]),
  "library.savedList": () => Effect.succeed({ items: [], total: 0 }),
  "library.collectionsList": () => Effect.succeed([]),
} as const;

/** The engine as a test drives it: every script X's page runs, answered by `reply`. */
function engine(reply: (code: string) => unknown) {
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve(reply(code));
    },
  } as unknown as XWebview);
  markXReady();
  return scripts;
}

it("shows X's own Radar intro and its Subscribe to Premium link when X's page shows X's upsell", async () => {
  installFakeBridge();
  const scripts = engine(() => true);
  try {
    await using screen = await render(
      <>
        <EngineSync />
        <RadarTab />
      </>,
      { service },
    );
    await expect
      .element(screen.getByRole("heading", { name: "Be the very first to spot trends with Radar" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Subscribe to Premium" }))
      .toHaveAttribute("href", "https://x.com/i/premium_sign_up");
    expect(scripts.some((s) => s.includes('"/i/radar"'))).toBe(true);
  } finally {
    registerXWebview(null);
  }
});

it("lists X's queries in X's order, opens one's days and posts, and creates one through X's own form", async () => {
  const post = synth().home!.batches.flatMap((b) => b.posts)[0]!;
  const bridge = installFakeBridge();
  // A Premium account: no upsell on X's page, and X opens the new query's page once it took it.
  const scripts = engine((code) =>
    code.includes("premium_sign_up") ? false : code.includes("icon-arrow-up") ? "1803" : true,
  );
  try {
    await using screen = await render(
      <>
        <EngineSync />
        <RadarTab />
      </>,
      {
        service: {
          ...service,
          "settings.get": () => Effect.succeed({ ...settings, sessionPostingEnabled: true }),
        },
      },
    );
    bridge.emitEngine(
      answer("insightsListContextQuery", {
        key: "radar",
        radarQueries: [query("1802", "", "$GOOGL OR $AAPL"), query("1801", "Bitcoin", "bitcoin")],
      }),
    );
    bridge.emitEngine(answer("insightsConfigQuery", { radarLimit: 3 }));
    const days = [
      { at: "2026-11-01T00:00:00.000Z", count: 40 },
      { at: "2026-11-02T00:00:00.000Z", count: 6 },
    ];
    bridge.emitEngine(answer("usePostCountQuery", { key: "1801", radarCounts: days }));
    const rows = screen.getByRole("listitem");
    await expect
      .poll(() => rows.elements().map((r) => r.textContent))
      .toEqual([
        expect.stringMatching(/^Untitled query.*\$GOOGL OR \$AAPL$/),
        expect.stringMatching(/^Bitcoin.*bitcoinPosts46$/),
      ]);

    await userEvent.click(screen.getByRole("button", { name: /^Bitcoin/ }));
    await expect.poll(() => scripts.some((s) => s.includes('"/i/radar/1801"'))).toBe(true);
    bridge.emitEngine(
      answer("postListQuery", { key: "radar:Top:bitcoin", posts: [post], order: [post.postId] }),
    );
    await expect.element(screen.getByText(post.text)).toBeVisible();
    await expect.element(screen.getByText("Posts", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("46", { exact: true })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "All queries" }));
    await userEvent.click(screen.getByRole("button", { name: "New query" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "Query" }), "$NVDA (sell OR buy)");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    // X's own form gets the query and X's own Submit; X's new page is the query's.
    await expect
      .poll(() =>
        scripts.some((s) => s.includes("icon-arrow-up") && s.includes('"$NVDA (sell OR buy)"')),
      )
      .toBe(true);
    bridge.emitEngine(
      answer("insightProviderGetQuery", {
        key: "1803",
        radarQueries: [query("1803", "", "$NVDA (sell OR buy)")],
      }),
    );
    await expect.element(screen.getByRole("heading", { name: "Untitled query" })).toBeVisible();
    await expect.element(screen.getByText("$NVDA (sell OR buy)")).toBeVisible();
  } finally {
    registerXWebview(null);
  }
});

/** Renders the section on an engine where X has the account's queries, with session actions on. */
const premium = (reply: (code: string) => unknown, sessionActions: "on" | "loading" = "on") => {
  const bridge = installFakeBridge();
  const scripts = engine((code) => (code.includes("premium_sign_up") ? false : reply(code)));
  const screen = render(
    <>
      <EngineSync />
      <RadarTab />
      <Toasts />
    </>,
    {
      service: {
        ...service,
        "settings.get": () =>
          sessionActions === "on"
            ? Effect.succeed({ ...settings, sessionPostingEnabled: true })
            : Effect.never,
      },
    },
  );
  return { bridge, scripts, screen };
};

it("opens the first query X made from its empty Radar, though X's last list had none", async () => {
  const { bridge, screen: rendered } = premium((code) =>
    code.includes("icon-arrow-up") ? "1901" : true,
  );
  try {
    await using screen = await rendered;
    bridge.emitEngine(answer("insightsListContextQuery", { key: "radar", radarQueries: [] }));
    await userEvent.fill(screen.getByRole("textbox", { name: "Query" }), "solar");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    bridge.emitEngine(
      answer("insightProviderGetQuery", {
        key: "1901",
        radarQueries: [query("1901", "", "solar")],
      }),
    );
    await expect.element(screen.getByRole("heading", { name: "Untitled query" })).toBeVisible();
  } finally {
    registerXWebview(null);
  }
});

it("presses nothing on X while Settings has not said session actions are on", async () => {
  const { bridge, scripts, screen: rendered } = premium(() => true, "loading");
  try {
    await using screen = await rendered;
    bridge.emitEngine(answer("insightsListContextQuery", { key: "radar", radarQueries: [] }));
    await userEvent.fill(screen.getByRole("textbox", { name: "Query" }), "solar");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await expect
      .element(screen.getByText("Your settings are still loading. Try again in a moment."))
      .toBeVisible();
    expect(scripts.some((s) => s.includes("icon-arrow-up"))).toBe(false);
  } finally {
    registerXWebview(null);
  }
});

it("shows a one-query plan's query as X does, with X's own Radar page a click away", async () => {
  const { bridge, screen: rendered } = premium(() => true);
  try {
    await using screen = await rendered;
    bridge.emitEngine(answer("insightsConfigQuery", { radarLimit: 1 }));
    bridge.emitEngine(
      answer("insightsListContextQuery", {
        key: "radar",
        radarQueries: [query("1902", "Explore X", "solar")],
      }),
    );
    await expect.element(screen.getByRole("heading", { name: "Explore X" })).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Open on X" }))
      .toHaveAttribute("href", "https://x.com/i/radar");
  } finally {
    registerXWebview(null);
  }
});

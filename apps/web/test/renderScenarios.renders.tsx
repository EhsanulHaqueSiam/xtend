// Render scenarios for scripts/render-metrics.ts. Each mounts real screens on fixed fixtures,
// counts React commits and component renders while it drives them, and writes the counts through
// the writeRenderReport browser command. Native X screens read engine fixtures, as `?engine=` does.
import { useAtomSet } from "@effect/atom-react";
import type { Draft, EngineBatch, SavedPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { commands, page } from "vite-plus/test/browser";

import "~/index.css";

import { DraftsBoard } from "~/components/compose/DraftsBoard";
import { SwipeTab } from "~/components/library/SwipeTab";
import { parseFixture } from "~/components/xnative/engineFixtures";
import { Timeline } from "~/components/xnative/Timeline";
import { engineAtom, mergeBatch, updateEngine } from "~/state/engine";

import home from "./fixtures/engine/home.ndjson?raw";
import type { FakeService } from "./fakeService";
import { draft, xPost } from "./fixtures";
import { commitsSoFar, startCounting, stopCounting } from "./renderCounter";
import { render } from "./render";

declare module "vite-plus/test/browser" {
  interface BrowserCommands {
    /** Defined in vite.config.ts for the renders project. */
    writeRenderReport: (scenario: string, json: string) => Promise<void>;
  }
}

const DESKTOP = { width: 1440, height: 900 } as const;
const { batches: HOME } = parseFixture(home);
const following = HOME.find((b) => b.op === "HomeLatestTimeline")!;

/** Ten new posts on Following, fetched with the list's top cursor: X's newer page, behind the pill. */
const NEWER: EngineBatch = {
  ...following,
  cursor: following.top,
  top: `${following.top}-newer`,
  posts: following.posts.map((p, i) => ({
    ...p,
    postId: `9${p.postId.slice(1)}`,
    createdAt: new Date(Date.parse(p.createdAt) + 3_600_000 + i).toISOString(),
  })),
  order: following.order.map((id) => `9${id.slice(1)}`),
};

/** Mounted beside a native screen: hands the scenario the store's merge, as EngineSync uses it. */
function Feed({ bind }: { readonly bind: (apply: (batch: EngineBatch) => void) => void }) {
  const setEngine = useAtomSet(engineAtom);
  bind((batch) => setEngine(updateEngine((s) => mergeBatch(s, batch))));
  return null;
}

let apply: (batch: EngineBatch) => void = () => {};
const homeScreen = (
  <div style={{ height: DESKTOP.height, display: "flex" }}>
    <Feed bind={(a) => (apply = a)} />
    <Timeline surface="following" header={null} empty="Loading" onReopen={() => {}} />
  </div>
);

const DRAFT_STATUSES = ["draft", "queued", "posted", "failed", "suggested"] as const;
const drafts = Array.from({ length: 60 }, (_, i): Draft =>
  draft(`d${i}`, DRAFT_STATUSES[i % DRAFT_STATUSES.length]!, {
    blocks: [{ text: `Draft ${i}: the pricing page converted better once it showed proof` }],
  }),
);

const saved = Array.from({ length: 100 }, (_, i): SavedPost => ({
  id: i + 1,
  post: xPost(
    String(1_980_000_000_000_000_000n + BigInt(i)),
    "Nobody tells you this: the first 1,000 followers come from replies, not posts.\n\n".repeat(
      (i % 4) + 1,
    ),
  ),
  note: "",
  savedAt: "2026-10-20T12:00:00.000Z",
  collectionIds: [],
}));
const library: FakeService = {
  "library.savedList": () => Effect.succeed({ items: saved, total: saved.length }),
};

// Virtuoso measures rows, and images decode, on later frames; how much lands inside a window
// varies run to run. Every window opens and closes on a quiet tree: no commit across two checks.
async function quiet() {
  let seen = -1;
  await vi.waitFor(
    () => {
      const now = commitsSoFar();
      const settled = now === seen;
      seen = now;
      expect(settled).toBe(true);
    },
    { interval: 100, timeout: 10_000 },
  );
}

// A first mount loads lazy modules and fonts at varying times; the counted run starts warm.
async function warmUp(ui: ReactNode, options: { service?: FakeService } = {}) {
  await using screen = await render(ui, { service: options.service ?? {} });
  await document.fonts.ready;
  await quiet();
  expect(screen.container.childElementCount).toBeGreaterThan(0);
}

/** The native list drew the fixture's posts (Virtuoso keeps off-screen copies, so count rows). */
const drawn = (root: HTMLElement) =>
  vi.waitFor(() => expect(root.querySelectorAll("article").length).toBeGreaterThan(0));

async function report(scenario: string) {
  await quiet();
  await commands.writeRenderReport(scenario, JSON.stringify(stopCounting()));
}

it("home-mount", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  await warmUp(homeScreen);
  startCounting();
  await using screen = await render(homeScreen, { service: {} });
  for (const batch of HOME) apply(batch);
  await drawn(screen.container);
  await report("home-mount");
});

// New posts arriving on an open Home: they wait behind X's pill, so the list must not re-render.
it("home-new-posts", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  await warmUp(homeScreen);
  await using screen = await render(homeScreen, { service: {} });
  for (const batch of HOME) apply(batch);
  await drawn(screen.container);
  await quiet();
  startCounting();
  apply(NEWER);
  await vi.waitFor(() =>
    expect(screen.container.textContent).toContain(`Show ${NEWER.order.length} posts`),
  );
  await report("home-new-posts");
});

it("compose-board", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const ui = (
    <DraftsBoard drafts={drafts} costOf={() => 0.015} onOpen={() => {}} onChanged={() => {}} />
  );
  await warmUp(ui);
  startCounting();
  await using screen = await render(ui, { service: {} });
  await expect.element(screen.getByText("Draft 0:", { exact: false }).first()).toBeVisible();
  await report("compose-board");
});

it("library-swipe", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  await warmUp(<SwipeTab />, { service: library });
  startCounting();
  await using screen = await render(<SwipeTab />, { service: library });
  await vi.waitFor(() => expect(screen.container.querySelectorAll("article")).toHaveLength(100));
  await report("library-swipe");
});

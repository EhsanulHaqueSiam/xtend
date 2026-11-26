import type { EngineBatch, EngineBroadcastRow } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

// The app's layout, so the list has a height to draw its rows in.
import "~/index.css";
import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { ANALYTICS_CLAIM, emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { ENDED_BROADCAST, synth } from "../xnative/engineFixtures";
import { XLiveSection } from "./XLive";

const batches = synth().accountAnalytics!.batches;
const list = batches.find((b) => b.op === "liveOverviewProviderQuery")!;
const details = batches.find((b) => b.op === "liveDetailsQuery" && b.key === ENDED_BROADCAST)!;
const [stats] = batches.flatMap((b) =>
  b.liveAnalytics?.kind === "broadcast" ? [b.liveAnalytics.broadcast] : [],
);
const { liveAnalytics: _, ...base } = list;
const noClaims: EngineBatch = { ...base, op: "GetUserClaims", key: null, claims: [] };
/** X's first page of the list, and whether X has more. */
const listPage = (broadcasts: ReadonlyArray<EngineBroadcastRow>, more: boolean): EngineBatch => ({
  ...base,
  liveAnalytics: { kind: "list", broadcasts, more },
});
const fixtureRows = list.liveAnalytics?.kind === "list" ? list.liveAnalytics.broadcasts : [];

/**
 * The section on a fresh store, the engine a fake webview whose scripts the test reads; `upsell` is
 * what X's Live page shows: its upsell (true), its list (false), or neither yet (null).
 */
async function open(upsell: boolean | null = null) {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => (
      scripts.push(code),
      Promise.resolve(code.includes("Upgrade to continue") ? upsell : null)
    ),
  } as unknown as XWebview);
  markXReady();
  const container = document.createElement("div");
  container.style.height = "800px";
  const screen = await render(
    <>
      <EngineSync />
      <XLiveSection />
    </>,
    { service: {}, container },
  );
  const rows = () =>
    [...screen.container.querySelectorAll('[data-x="broadcast-row"]')].map((r) =>
      [...r.querySelectorAll("td")].map((td, i) =>
        i === 0 ? td.querySelector(".font-medium")?.textContent : td.textContent,
      ),
    );
  return {
    bridge,
    scripts,
    screen,
    rows,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      registerXWebview(null);
    },
  };
}

it("lists the user's broadcasts newest first in X's words, X's filters narrow them, and one opens X's numbers", async () => {
  await using x = await open();
  const { bridge, scripts, screen, rows } = x;
  await expect.poll(() => scripts.some((s) => s.includes("/i/account_analytics/live"))).toBe(true);
  // X's claims leave the account out, until X answers with its broadcasts.
  bridge.emitEngine(noClaims);
  await expect.element(screen.getByText("Advanced analytics with Plus")).toBeVisible();
  bridge.emitEngine(list);
  // X's order: when it is scheduled, else when it started.
  await expect.poll(() => rows().length).toBe(3);
  expect(rows()).toEqual([
    ["Launch week AMA", "0", "0", "0"],
    ["Building Xtend live", "1,284", "402", "3,910"],
    ["Office hours", "318", "121", "866"],
  ]);
  expect(screen.container.querySelectorAll('[data-x="broadcast-row"]')[1]?.textContent).toContain(
    "1:12:40 · Ended",
  );

  await userEvent.click(screen.getByRole("button", { name: "Filter: All" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Live" }));
  await expect
    .element(screen.getByText("No broadcasts available for the selected filter"))
    .toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Filter: Live" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Ended" }));
  await expect.poll(() => rows().map((r) => r[0])).toEqual(["Building Xtend live", "Office hours"]);

  await userEvent.click(screen.getByRole("button", { name: /^Building Xtend live/ }));
  await expect
    .poll(() => scripts.some((s) => s.includes(`/i/account_analytics/live/${ENDED_BROADCAST}`)))
    .toBe(true);
  bridge.emitEngine(details);
  const tile = (label: string) =>
    screen.container.querySelector(`[data-x-tile="${label}"] dd`)?.textContent;
  await expect.poll(() => tile("Duration")).toBe("1:12:40");
  expect([tile("Views"), tile("Unique viewers"), tile("Minutes watched")]).toEqual([
    "1,284",
    "402",
    "3,910",
  ]);
  // X's Live Viewers by the minute, with its peak.
  await expect.element(screen.getByText("Peak Viewers: 120")).toBeVisible();
});

it("shows X's paywall when X's Live page shows its upsell, even with X's claims letting the account in", async () => {
  await using x = await open(true);
  x.bridge.emitEngine({ ...noClaims, claims: [ANALYTICS_CLAIM] });
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).toBeVisible();
});

it("says when X has more than its first page, under the list and in a filter with none, and opens X's page for all", async () => {
  await using x = await open();
  const [ended, office] = fixtureRows;
  const latest = "Showing your latest 2 broadcasts. Open on X for all";
  x.bridge.emitEngine(listPage([ended!, office!], true));
  await expect.poll(() => x.rows().length).toBe(2);
  expect(x.screen.container.textContent).toContain(latest);
  await expect
    .element(x.screen.getByRole("link", { name: "Open on X for all" }))
    .toHaveAttribute("href", "https://x.com/i/account_analytics/live");
  // None scheduled among them, but X has more: not X's empty line, which would say there are none.
  await userEvent.click(x.screen.getByRole("button", { name: "Filter: All" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Scheduled" }));
  await expect.poll(() => x.screen.container.textContent).toContain(latest);
  expect(x.screen.container.textContent).not.toContain("No broadcasts available");
});

it("draws every minute of a long broadcast's viewers, its peak at its own minute, and says when X has no such broadcast", async () => {
  await using x = await open();
  x.bridge.emitEngine(list);
  await x.screen.getByRole("button", { name: /^Building Xtend live/ }).click();
  // 241 minutes, 12 viewers but 500 at minute 239.
  x.bridge.emitEngine({
    ...details,
    liveAnalytics: {
      kind: "broadcast",
      broadcast: {
        ...stats!,
        concurrent: Array.from({ length: 241 }, (_, i) => (i === 239 ? 500 : 12)),
      },
    },
  });
  await expect.element(x.screen.getByText("Peak Viewers: 500")).toBeVisible();
  // Every minute is drawn, each at its own x: the peak sits at minute 239 of 240.
  await expect.element(x.screen.getByRole("slider")).toHaveAttribute("aria-valuemax", "241");
  const line = x.screen.container.querySelector('svg path[fill="none"]')!.getAttribute("d")!;
  const peak = [...line.matchAll(/[ML]([\d.]+),([\d.]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2])] as const)
    .reduce((top, v) => (v[1] < top[1] ? v : top));
  expect(peak[0]).toBe((239 / 240) * 600);
  expect(
    [...x.screen.container.querySelectorAll('[aria-live="polite"] span')].map((s) => s.textContent),
  ).toEqual(["0:00", "12 to 500", "4:00:00"]);

  await x.screen.getByRole("button", { name: "Back to broadcasts" }).click();
  await x.screen.getByRole("button", { name: /^Office hours/ }).click();
  x.bridge.emitEngine({
    ...details,
    key: "900000800002",
    liveAnalytics: { kind: "unavailable", broadcastId: "900000800002" },
  });
  await expect
    .element(x.screen.getByText("X has no analytics for this broadcast. It may have been deleted."))
    .toBeVisible();
});

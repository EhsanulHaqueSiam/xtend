import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { ENDED_BROADCAST, synth } from "../xnative/engineFixtures";
import { XLiveSection } from "./XLive";

const batches = synth().accountAnalytics!.batches;
const list = batches.find((b) => b.op === "liveOverviewProviderQuery")!;
const details = batches.find((b) => b.op === "liveDetailsQuery")!;
const { liveAnalytics: _, ...base } = list;
const noClaims: EngineBatch = { ...base, op: "GetUserClaims", key: null, claims: [] };

it("lists the user's broadcasts newest first in X's words, X's filters narrow them, and one opens X's numbers", async () => {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(null)),
  } as unknown as XWebview);
  markXReady();
  await using screen = await render(
    <>
      <EngineSync />
      <XLiveSection />
    </>,
    { service: {} },
  );
  await expect.poll(() => scripts.some((s) => s.includes("/i/account_analytics/live"))).toBe(true);
  // X's claims leave the account out, until X answers with its broadcasts.
  bridge.emitEngine(noClaims);
  await expect.element(screen.getByText("Advanced analytics with Plus")).toBeVisible();
  bridge.emitEngine(list);
  const rows = () =>
    [...screen.container.querySelectorAll('[data-x="broadcast-row"]')].map((r) =>
      [...r.querySelectorAll("td")].map((td, i) =>
        i === 0 ? td.querySelector(".font-medium")?.textContent : td.textContent,
      ),
    );
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

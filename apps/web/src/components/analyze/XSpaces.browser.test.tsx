import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { RECORDED_SPACE, synth } from "../xnative/engineFixtures";
import { XSpacesSection } from "./XSpaces";

const batches = synth().spaces!.batches;
const list = batches.find((b) => b.op === "spacesOverviewProviderQuery")!;
const details = batches.find((b) => b.op === "spacesDetailsProviderQuery")!;
const claims = (access: boolean): EngineBatch => {
  const { spaceAnalytics: _, ...base } = list;
  return {
    ...base,
    op: "GetUserClaims",
    key: null,
    claims: access ? ["subscriptions_feature_account_analytics"] : [],
  };
};

async function open() {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => (scripts.push(code), Promise.resolve(null)),
  } as unknown as XWebview);
  markXReady();
  const screen = await render(
    <>
      <EngineSync />
      <XSpacesSection />
    </>,
    { service: {} },
  );
  return { bridge, scripts, screen };
}

it("lists the user's Spaces in X's words from X's page, and a Space opens X's own numbers for it", async () => {
  const x = await open();
  await using _ = x.screen;
  await expect
    .poll(() => x.scripts.some((s) => s.includes("/i/account_analytics/spaces")))
    .toBe(true);
  x.bridge.emitEngine(list);
  const rows = () =>
    [...x.screen.container.querySelectorAll('[data-x="space-row"]')].map((r) =>
      [...r.querySelectorAll("td")].map((td) => td.textContent),
    );
  await expect.poll(() => rows().length).toBe(2);
  // Ended with a recording reads Recorded, as X's badge does; a scheduled Space has no numbers yet.
  expect(rows()[0]!.slice(1)).toEqual(["Recorded", "48:20", "1,094", "318", "1"]);
  expect(rows()[1]!.slice(1)).toEqual(["Scheduled", "-", "-", "-", "1"]);

  await x.screen.getByRole("button", { name: /^Office hours: pricing pages/ }).click();
  await expect
    .poll(() => x.scripts.some((s) => s.includes(`/i/account_analytics/spaces/${RECORDED_SPACE}`)))
    .toBe(true);
  x.bridge.emitEngine(details);
  const tile = (label: string) =>
    x.screen.container.querySelector(`[data-x-tile="${label}"] dd`)?.textContent;
  await expect.poll(() => tile("Peak Concurrent Listeners")).toBe("226");
  expect([tile("Total Participants"), tile("Total Replay Watched")]).toEqual(["1,412", "318"]);
});

it("shows X's paywall to an account X's claims leave out, until X answers with its Spaces", async () => {
  const x = await open();
  await using _ = x.screen;
  x.bridge.emitEngine(claims(false));
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).toBeVisible();
  // X's gate lets in some accounts its claims do not name: X's answer wins.
  x.bridge.emitEngine(list);
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).not.toBeInTheDocument();
});

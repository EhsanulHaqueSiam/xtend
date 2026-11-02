import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

// The app's layout, so the content table has a height to draw its rows in.
import "~/index.css";
import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { synth } from "../xnative/engineFixtures";
import { XAnalyticsSection, type XSection } from "./XAnalytics";

const fixture = synth().accountAnalytics!.batches;
const answer = (key: string) => fixture.find((b) => b.key === key)!;
const claims = (analyticsAccess: boolean): EngineBatch => ({
  ...fixture.find((b) => b.op === "GetUserClaims")!,
  analyticsAccess,
});

/** One section on a fresh store, the engine a fake webview whose scripts the test reads. */
async function open(section: XSection) {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve(true);
    },
  } as unknown as XWebview);
  markXReady();
  // A window's height, so the content table has rows to draw.
  const container = document.createElement("div");
  container.style.height = "800px";
  const screen = await render(
    <>
      <EngineSync />
      <XAnalyticsSection section={section} />
    </>,
    { service: {}, container },
  );
  return {
    bridge,
    scripts,
    screen,
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      registerXWebview(null);
    },
  };
}

it("shows X's paywall and its Upgrade page to an account X's claims leave out", async () => {
  await using x = await open("x-overview");
  // The engine opens X's analytics; until X says, the web app alone says where they come from.
  await expect
    .element(x.screen.getByText("X's analytics come from X's own page, in the desktop app."))
    .toBeVisible();
  expect(x.scripts.some((s) => s.includes('"/i/account_analytics"'))).toBe(true);

  x.bridge.emitEngine(claims(false));
  await expect.element(x.screen.getByText("Advanced analytics with X Premium")).toBeVisible();
  await expect
    .element(x.screen.getByRole("link", { name: "Upgrade" }))
    .toHaveAttribute("href", "https://x.com/i/premium_sign_up");
  await expect.element(x.screen.getByRole("tab", { name: "7D" })).not.toBeInTheDocument();

  // X's own page let the account in after all (a verified organisation): X's numbers win.
  x.bridge.emitEngine(answer("overview:7"));
  await expect
    .element(x.screen.getByText("Advanced analytics with X Premium"))
    .not.toBeInTheDocument();
  await expect.element(x.screen.getByRole("tab", { name: "7D" })).toBeVisible();
});

it("draws X's overview for the range X's page shows, and a pick presses X's own range button", async () => {
  await using x = await open("x-overview");
  const tile = (label: string) =>
    x.screen.container.querySelector(`[data-x-tile="${label}"]`)?.textContent;
  x.bridge.emitEngine(claims(true));
  x.bridge.emitEngine(answer("overview:7"));
  // X's totals over the made-up week, and engagements over impressions as X's page derives them.
  await expect.poll(() => tile("Impressions")).toBe("Impressions3,150↑200%");
  expect([tile("Engagements"), tile("Engagement rate"), tile("Verified followers")]).toEqual([
    "Engagements137↑108%",
    "Engagement rate4.3%↓31%",
    "Verified followers212 / 1,840",
  ]);
  await expect
    .element(x.screen.getByRole("tab", { name: "7D" }))
    .toHaveAttribute("aria-selected", "true");

  await userEvent.click(x.screen.getByRole("tab", { name: "4W" }));
  await expect
    .poll(() => x.scripts.some((s) => s.includes('"4W"') && s.includes('"/i/account_analytics"')))
    .toBe(true);
  // Picked until X answers; the week's numbers are not 4W's.
  await expect
    .element(x.screen.getByRole("tab", { name: "4W" }))
    .toHaveAttribute("aria-selected", "true");
  expect(tile("Impressions")).toBe(undefined);
  x.bridge.emitEngine(answer("overview:28"));
  await expect.poll(() => tile("Impressions")).toBe("Impressions11,385↑171%");
});

it("lists X's content of a type, and a post opens its own Post Analytics", async () => {
  await using x = await open("x-content");
  x.bridge.emitEngine(answer("content:7"));
  // X opens on Posts: the reply waits under Replies.
  await expect
    .element(x.screen.getByText("Rewrote our pricing page in one afternoon.", { exact: false }))
    .toBeVisible();
  await expect
    .element(x.screen.getByText("Happy to share the template", { exact: false }))
    .not.toBeInTheDocument();
  await userEvent.click(x.screen.getByRole("button", { name: "Type" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Replies" }));
  await userEvent.click(x.screen.getByText("Happy to share the template", { exact: false }));
  expect(x.screen.router!.state.location.href).toBe("/post/700000000901/analytics?h=i");
});

it("breaks X's audience down by the engagement picked, rounded as X's page rounds it", async () => {
  await using x = await open("x-audience");
  x.bridge.emitEngine(answer("audience:7"));
  const shares = (title: string) =>
    Array.from(
      [...x.screen.container.querySelectorAll("section")]
        .find((s) => s.querySelector("h2")?.textContent === title)
        ?.querySelectorAll("li") ?? [],
      (li) => li.textContent,
    );
  // Likes: what a tenth leaves of 100 goes to the largest share.
  await expect
    .poll(() => shares("Gender"))
    .toEqual(["Male36.6%", "Female50.1%", "Not specified13.3%"]);
  expect(shares("Country")).toEqual(["Bangladesh68.4%", "United States31.6%"]);
  expect(shares("Device")).toEqual(["iOS50.1%", "Android36.6%", "Web13.3%", "Other0.0%"]);
  await userEvent.click(x.screen.getByRole("button", { name: "Metric" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Impressions" }));
  await expect
    .poll(() => shares("Gender"))
    .toEqual(["Male100.0%", "Female0.0%", "Not specified0.0%"]);
});

it("counts X's video numbers for the range, and lists the videos", async () => {
  await using x = await open("x-video");
  const tile = (label: string) =>
    x.screen.container.querySelector(`[data-x-tile="${label}"]`)?.textContent;
  x.bridge.emitEngine(answer("video:7"));
  x.bridge.emitEngine(answer("videos"));
  await expect.poll(() => tile("Completion Rate")).toBe("Completion Rate67%");
  expect([tile("Views"), tile("Watch Time (hours)"), tile("Average Watch Time")]).toEqual([
    "Views3",
    "Watch Time (hours)0",
    "Average Watch Time0:37",
  ]);
  await expect.element(x.screen.getByText("Editor dark mode walkthrough")).toBeVisible();
  await expect.element(x.screen.getByText("Untitled")).toBeVisible();
});

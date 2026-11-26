import type { EngineBatch } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

// The app's layout, so the content table has a height to draw its rows in.
import "~/index.css";
import { installFakeBridge } from "../../../test/fakeBridge";
import { render } from "../../../test/render";
import { ANALYTICS_CLAIM, emptyEngine, updateEngine } from "../../state/engine";
import { markXReady, registerXWebview, type XWebview } from "../../state/x";
import { EngineSync } from "../xnative/EngineSync";
import { synth } from "../xnative/engineFixtures";
import { XAnalyticsSection, type XSection } from "./XAnalytics";

const fixture = synth().accountAnalytics!.batches;
// As the desktop sends it: the range shown is X's page's to say, never the fixture's.
const answer = (key: string): EngineBatch => {
  const { analyticsShown: _, ...sent } = fixture.find((b) => b.key === key)!;
  return sent;
};
const claims = (access: boolean): EngineBatch => {
  const { accountAnalytics: _, ...base } = answer("content:7");
  return { ...base, op: "GetUserClaims", key: null, claims: access ? [ANALYTICS_CLAIM] : [] };
};

/**
 * One section on a fresh store, the engine a fake webview whose scripts the test reads. `upsell`
 * is what X's page shows: its upsell (true), its analytics (false), or neither yet (null);
 * `range` its selected range button, null when it draws none.
 */
async function open(section: XSection, upsell: boolean | null = null, range: string | null = "7D") {
  updateEngine(() => emptyEngine);
  const bridge = installFakeBridge();
  const scripts: Array<string> = [];
  // X's page opens on 7D; a test can make reading its selected range fail, or hold the next read.
  let shown = range;
  let readFails = false;
  let held: ((label: string) => void) | null = null;
  let holdNext = false;
  registerXWebview({
    getURL: () => "https://x.com/home",
    loadURL: () => Promise.resolve(),
    executeJavaScript: (code: string) => {
      scripts.push(code);
      // X's page shows the range last pressed, by its primary style; none before a press.
      if (code.includes("bg-btn-primary")) {
        if (!holdNext) return Promise.resolve(readFails ? null : shown);
        holdNext = false;
        return new Promise((resolve) => (held = resolve));
      }
      const pressed = /b\.textContent\.trim\(\) === ("[^"]+")\)/.exec(code)?.[1];
      if (pressed !== undefined) shown = JSON.parse(pressed) as string;
      return Promise.resolve(code.includes("Upgrade to continue") ? upsell : true);
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
    failReads: () => {
      readFails = true;
    },
    holdRead: () => {
      holdNext = true;
    },
    /** Answers the held read with `label`, once it is held. */
    release: (label: string) => held?.(label),
    held: () => held !== null,
    show: (label: string) => {
      shown = label;
    },
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
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).toBeVisible();
  await expect
    .element(x.screen.getByRole("link", { name: "Upgrade" }))
    .toHaveAttribute("href", "https://x.com/i/premium_sign_up");
  await expect.element(x.screen.getByRole("tab", { name: "7D" })).not.toBeInTheDocument();

  // X's own page let the account in after all (a verified organisation): X's numbers win.
  x.bridge.emitEngine(answer("overview:7"));
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).not.toBeInTheDocument();
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

  // Back to 7D, which X shows from its own store and asks nothing for, and reading X's selected
  // range then fails: the press landed, so it is 7D, never the 4W before. Leaving the section and
  // coming back still shows 7D, as X's page does.
  const reads = () => x.scripts.filter((s) => s.includes("bg-btn-primary")).length;
  const before = reads();
  x.failReads();
  await userEvent.click(x.screen.getByRole("tab", { name: "7D" }));
  // Each of the read's three tries waits for X's page to load anew before the next.
  for (const tried of [1, 2, 3]) {
    await expect.poll(reads).toBe(before + tried);
    markXReady();
  }
  await expect.poll(() => updateEngine((s) => s).accountAnalytics.picking).toEqual({});
  expect(tile("Impressions")).toBe("Impressions3,150↑200%");
  await x.screen.rerender(<XAnalyticsSection key="away" section="x-content" />);
  await x.screen.rerender(<XAnalyticsSection key="back" section="x-overview" />);
  await expect
    .element(x.screen.getByRole("tab", { name: "7D" }))
    .toHaveAttribute("aria-selected", "true");
  expect(tile("Impressions")).toBe("Impressions3,150↑200%");
});

it("under 50 followers, where X's page has no range buttons, shows the one range X answered", async () => {
  await using x = await open("x-overview", false, null);
  const sent = answer("overview:7");
  x.bridge.emitEngine(claims(true));
  x.bridge.emitEngine({
    ...sent,
    accountAnalytics: { ...sent.accountAnalytics!, followers: 16, verifiedFollowers: 6 },
  } as EngineBatch);
  await expect
    .element(
      x.screen.getByText(
        "Detailed engagement metrics become available once you reach 50 followers.",
      ),
    )
    .toBeVisible();
  await expect
    .poll(() => x.screen.container.querySelector('[data-x-tile="Verified followers"]')?.textContent)
    .toBe("Verified followers6 / 16");
  await expect.element(x.screen.getByRole("tab", { name: "7D" })).not.toBeInTheDocument();
});

it("lets a pick go with its section: back on X's 4W, the old 7D read changes nothing", async () => {
  await using x = await open("x-overview");
  x.show("4W");
  x.bridge.emitEngine(claims(true));
  x.bridge.emitEngine(answer("overview:28"));
  const fourWeeks = x.screen.getByRole("tab", { name: "4W" });
  await expect.element(fourWeeks).toHaveAttribute("aria-selected", "true");

  // 7D's press lands; the section is left while its read of X's page waits.
  x.holdRead();
  await userEvent.click(x.screen.getByRole("tab", { name: "7D" }));
  await expect.poll(x.held).toBe(true);
  await x.screen.rerender(<XAnalyticsSection key="away" section="x-content" />);
  // Back on the overview, X's page shows 4W.
  x.show("4W");
  await x.screen.rerender(<XAnalyticsSection key="back" section="x-overview" />);
  await expect.element(fourWeeks).toHaveAttribute("aria-selected", "true");
  expect(updateEngine((s) => s).accountAnalytics.picking).toEqual({});

  // The old read answers 7D and X's page loads anew, which ends its wait and has the open section
  // read X's page again (a script): by then the old read has settled, and 4W still shows.
  x.release("7D");
  const ran = x.scripts.length;
  markXReady();
  await expect.poll(() => x.scripts.length).toBeGreaterThan(ran);
  expect(updateEngine((s) => s).accountAnalytics.shown.overview).toBe(28);
  await expect.element(fourWeeks).toHaveAttribute("aria-selected", "true");
});

it("shows X's paywall when X sends no claims and X's own page shows its upsell", async () => {
  await using x = await open("x-overview", true);
  await expect.element(x.screen.getByText("Advanced analytics with Plus")).toBeVisible();
  await expect
    .element(x.screen.getByRole("link", { name: "Upgrade" }))
    .toHaveAttribute("href", "https://x.com/i/premium_sign_up");
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
  await userEvent.click(x.screen.getByRole("button", { name: "Type: Posts" }));
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
  // Who follows the user, in X's order and words.
  expect(shares("Following")).toEqual(["Followers63.4%", "Non-followers36.6%"]);
  await userEvent.click(x.screen.getByRole("button", { name: "Metric: Likes" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Impressions" }));
  await expect
    .poll(() => shares("Gender"))
    .toEqual(["Male100.0%", "Female0.0%", "Not specified0.0%"]);
  expect(shares("Following")).toEqual(["Followers0.0%", "Non-followers100.0%"]);
  // X's page asked its Active times for Likes, and says so beside another engagement.
  await expect
    .element(x.screen.getByRole("heading", { name: "Active times Last 28 days, for Likes" }))
    .toBeVisible();
  // X splits no new follows by following.
  await userEvent.click(x.screen.getByRole("button", { name: "Metric: Impressions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "New follows" }));
  await expect
    .element(x.screen.getByRole("heading", { name: "Following" }))
    .not.toBeInTheDocument();
});

it("draws X's Active times as X's page scales them: each weekday-hour's average, an outlier capped", async () => {
  await using x = await open("x-audience");
  const sent = answer("audience:7");
  // In the viewer's zone, as X's page buckets them: Monday's 9am twice, then each day's 9am once.
  const at = (day: number, count: number) => ({
    at: new Date(2026, 10, day, 9).toISOString(),
    count,
  });
  x.bridge.emitEngine({
    ...sent,
    accountAnalytics: {
      ...sent.accountAnalytics!,
      active: [at(2, 6), at(9, 14), at(3, 4), at(4, 2), at(5, 0), at(6, 100), at(7, 6), at(8, 8)],
    },
  } as EngineBatch);
  const opacity = (cell: string) =>
    Number(
      x.screen.container.querySelector<HTMLElement>(`[data-cell="${cell}"]`)?.style.opacity,
    ).toFixed(3);
  // Averages 0, 2, 4, 6, 8, 10 and 100: capped at 10 + 1.5 x (10 - 2) = 22, so Friday's 100 is the
  // deepest and Monday's 10 reads 10/22; an hour X counted nothing for is X's palest.
  await expect.poll(() => opacity("0-9")).toBe("0.536");
  expect([opacity("4-9"), opacity("6-9"), opacity("3-9"), opacity("0-10")]).toEqual([
    "1.000",
    "0.459",
    "0.150",
    "0.150",
  ]);
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

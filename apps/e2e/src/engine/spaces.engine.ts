import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import {
  GONE_SPACE,
  LIVE_SPACE,
  RECORDED_SPACE,
} from "../../../web/src/components/xnative/engineFixtures.ts";
import { STARTED_SPACE } from "../mockX/spaces.ts";
import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's Space dock on the desktop, with mock X's Spaces as the engine: opening a Space reads X's
 * answer for it, and only Start listening joins, through X's own button; X's dock then plays in
 * X's page across Xtend's screens, and every control presses X's own.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine();
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname + location.search");
const pane = () => e.app.locator('section[aria-label="x.com"]').getAttribute("data-mode");
const presses = () =>
  e.mock.state.presses.map((p) => `${p.kind} ${p.name} ${p.target ?? ""}`.trim());
const dock = () => e.app.locator('[data-x="space-dock"]');
const palette = async (command: string) => {
  await e.app.keyboard.press("Control+k");
  await e.app.getByRole("option", { name: command, exact: true }).click();
};

test("A post's Space opens the dock and joins nothing; Start listening joins through X's own button, and X keeps playing across Xtend's screens", async () => {
  const post = e.mock.state.fixtures().spaces!.batches[0]!.posts[0]!;
  const page = `/${post.author.handle}/status/${post.postId}`;
  const open = `/post/${post.postId}?h=${post.author.handle}`;
  await go(open);
  await expect.poll(enginePath).toBe(page);
  await e.app.locator('main [data-x="space-card"]').click();
  await dock().getByText("214 listening").waitFor();
  // X's card already answered for the Space: the dock moved nothing and pressed nothing.
  expect(await enginePath()).toBe(page);
  expect(presses().filter((p) => p.includes("space:"))).toEqual([]);
  expect(e.mock.state.spaces.dock).toBeNull();

  await dock().getByRole("button", { name: "Start listening" }).click();
  await dock().getByRole("button", { name: "Leave" }).waitFor();
  expect(presses()).toEqual(
    expect.arrayContaining([
      `press space:Start listening ${LIVE_SPACE}`,
      `write space:listen ${LIVE_SPACE}`,
    ]),
  );
  // X closes the Space's page as it joins; the engine is back on the post.
  await expect.poll(enginePath).toBe(page);

  await dock().getByRole("button", { name: "Request to speak" }).click();
  await dock().getByRole("button", { name: "Cancel request" }).waitFor();
  expect(presses()).toContain(`write space:request ${LIVE_SPACE}`);
  await dock().getByRole("button", { name: "Show captions" }).click();
  await dock().getByText("Welcome in. We'll do twenty minutes on churn").waitFor();
  await dock().getByRole("button", { name: "React" }).click();
  await e.app.getByRole("menuitem", { name: "💯" }).click();
  await expect.poll(presses).toContain("write space:react 💯");

  // Xtend's screens, and a page Xtend does not draw (a full load anywhere else), move X's page
  // through X's router while it plays: the same page, its dock still up.
  await e.engine("window.__stillLoaded = true");
  await go("/bookmarks");
  await expect.poll(enginePath).toBe("/i/bookmarks");
  await palette("Notifications");
  await expect.poll(enginePath).toBe("/notifications");
  expect(await e.engine("window.__stillLoaded === true")).toBe(true);
  expect(e.mock.state.spaces.dock?.spaceId).toBe(LIVE_SPACE);
  expect(presses()).not.toContain("write space:unload");

  await go(open);
  await expect.poll(enginePath).toBe(page);
  await dock().getByRole("button", { name: "Leave" }).click();
  await dock().getByRole("button", { name: "Start listening" }).waitFor();
  expect(presses()).toContain(`write space:leave ${LIVE_SPACE}`);
  expect(e.mock.state.spaces.dock).toBeNull();
});

test("Start a Space opens X's own Create your Space over the main area, and End asks in X's own confirm", async () => {
  await go("/home?feed=following");
  await palette("Start a Space");
  await expect.poll(enginePath).toBe("/i/spaces/start");
  await expect.poll(pane).toBe("main");
  await e.engine(
    `(() => { document.querySelector('[data-space-start] input[name="title"]').value = "Office hours"; document.querySelector("[data-space-start-now]").click(); return true; })()`,
  );
  await expect.poll(pane).toBe("hidden");
  expect(presses()).toContain("write space:start Office hours");
  // Xtend's dock follows X's to the Space the user hosts, as X's answer names its host.
  await dock().getByText("Office hours").waitFor();
  await dock().getByRole("button", { name: "Mute" }).click();
  await dock().getByRole("button", { name: "Unmute" }).waitFor();

  await dock().getByRole("button", { name: "End", exact: true }).click();
  await expect.poll(pane).toBe("main");
  const confirm = `document.querySelector('#layers [data-testid="confirmationSheetConfirm"]')`;
  await expect.poll(() => e.engine(`!!${confirm}`)).toBe(true);
  await e.engine(`${confirm}.click(), true`);
  await expect.poll(pane).toBe("hidden");
  await expect.poll(presses).toContain(`write space:end ${STARTED_SPACE}`);
  // X showed the Space ended; the engine is back on Home, and the dock says so.
  await dock().getByText("ENDED").waitFor();
  await expect.poll(enginePath).toBe("/home");
});

test("X's Space analytics show X's paywall to an account without Premium", async () => {
  // X's claims come with a full load of its page.
  e.mock.state.setPremium(false);
  try {
    await e.engine("location.reload(), true");
    await go("/analyze?tab=x-spaces");
    await e.app.getByText("Advanced analytics with Plus").waitFor();
    expect(await e.app.getByRole("link", { name: "Upgrade" }).getAttribute("href")).toBe(
      "https://x.com/i/premium_sign_up",
    );
  } finally {
    e.mock.state.setPremium(true);
    await e.engine("location.reload(), true");
  }
});

test("A recording plays through X's own player and reads as X's captions; X's Space analytics list it with X's numbers", async () => {
  const recorded = e.mock.state.spaces.space(RECORDED_SPACE)!;
  const before = presses().length;
  // From X's Space analytics, the user's recorded Space opens its recording.
  await go("/analyze?tab=x-spaces");
  await expect.poll(enginePath).toBe("/i/account_analytics/spaces");
  const row = e.app.locator('[data-x="space-row"]').first();
  await row.getByText(recorded.title).waitFor();
  await row.click();
  await expect.poll(enginePath).toBe(`/i/account_analytics/spaces/${RECORDED_SPACE}`);
  await e.app.locator('[data-x-tile="Peak Concurrent Listeners"]').getByText("226").waitFor();
  await e.app.getByRole("button", { name: "Open the recording" }).click();

  const screen = e.app.locator('[data-x="space-recording"]');
  await screen.getByText(recorded.title).waitFor();
  expect(
    presses()
      .slice(before)
      .filter((p) => p.includes("space:")),
  ).toEqual([]);
  await screen.getByRole("button", { name: "Play recording" }).click();
  await expect.poll(presses).toContain(`write space:play ${RECORDED_SPACE}`);
  await screen.getByText("0:00 / 48:20").waitFor();
  // X sends the recording's captions only while they are on, from its recording chat.
  await screen.getByRole("button", { name: "Show captions" }).click();
  await expect.poll(() => screen.locator('[data-x="caption"]').count()).toBe(5);
  await screen.getByRole("button", { name: "Skip forward 15 seconds" }).click();
  await screen.getByText("0:15 / 48:20").waitFor();
  // A line is a place in the recording: X's own seek slider goes there.
  await screen.locator('[data-x="caption"]').nth(3).click();
  await expect.poll(() => e.mock.state.spaces.dock?.at).toBeGreaterThan(890_000);
  await screen.getByRole("button", { name: "1x" }).click();
  await e.app.getByRole("menuitem", { name: "1.5x speed" }).click();
  await screen.getByRole("button", { name: "1.5x" }).waitFor();
  await screen.getByRole("button", { name: "Pause" }).click();
  await screen.getByRole("button", { name: "Play", exact: true }).waitFor();

  // Elsewhere the dock shows what X plays, and its Close stops it.
  await go("/home?feed=following");
  await expect.poll(enginePath).toBe("/home");
  await dock().getByRole("button", { name: "Open the recording" }).waitFor();
  await dock().getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => e.mock.state.spaces.dock).toBeNull();
});

test("In X's compact layout (a narrow engine) X's Space pages are routes and End's confirm a sheet with no dialog role, and each still works", async () => {
  e.mock.state.spaces.setCompact(true);
  try {
    const post = e.mock.state.fixtures().spaces!.batches[0]!.posts[0]!;
    const page = `/${post.author.handle}/status/${post.postId}`;
    await go(`/post/${post.postId}?h=${post.author.handle}`);
    await expect.poll(enginePath).toBe(page);
    await e.app.locator('main [data-x="space-card"]').click();
    await dock().getByRole("button", { name: "Start listening" }).click();
    await dock().getByRole("button", { name: "Leave" }).waitFor();
    await expect.poll(enginePath).toBe(page);
    await dock().getByRole("button", { name: "Leave" }).click();
    await expect.poll(() => e.mock.state.spaces.dock).toBeNull();

    await palette("Start a Space");
    await expect.poll(enginePath).toBe("/i/spaces/start");
    await expect.poll(pane).toBe("main");
    await e.engine(
      `(() => { document.querySelector('[data-space-start] input[name="title"]').value = "Compact hours"; document.querySelector("[data-space-start-now]").click(); return true; })()`,
    );
    await expect.poll(pane).toBe("hidden");
    await dock().getByText("Compact hours").waitFor();
    await dock().getByRole("button", { name: "End", exact: true }).click();
    // X's sheet has no dialog role here; it shows over the main area all the same.
    await expect.poll(pane).toBe("main");
    const confirm = `document.querySelector('#layers [data-testid="confirmationSheetConfirm"]')`;
    await expect
      .poll(() =>
        e.engine(
          `!!${confirm} && !${confirm}.closest('[role]:not([role="button"]):not([role="none"])')`,
        ),
      )
      .toBe(true);
    await e.engine(`${confirm}.click(), true`);
    await expect.poll(pane).toBe("hidden");
    await expect.poll(presses).toContain(`write space:end ${STARTED_SPACE}`);
  } finally {
    e.mock.state.spaces.setCompact(false);
  }
});

test("A Space X has none of shows X's own error in the dock, and Xtend asks X for it once, not on every screen", async () => {
  const gone = e.mock.state
    .fixtures()
    .spaces!.batches.find((b) => b.op === "TweetDetail" && b.posts[0]!.spaceId === GONE_SPACE)!
    .posts[0]!;
  const asked = () =>
    e.mock.reads.filter((r) => r.op === "AudioSpaceById" && r.variables.id === GONE_SPACE).length;
  const open = `/post/${gone.postId}?h=${gone.author.handle}`;
  await go(open);
  await expect.poll(enginePath).toBe(`/${gone.author.handle}/status/${gone.postId}`);
  await e.app.locator('main [data-x="space-card"]').click();
  await dock().getByText("Something went wrong. Please try again later.").waitFor();
  const once = asked();
  // Other screens with the dock beside them, and back: X is asked nothing more for it.
  await go("/bookmarks");
  await expect.poll(enginePath).toBe("/i/bookmarks");
  await go(open);
  await expect.poll(enginePath).toBe(`/${gone.author.handle}/status/${gone.postId}`);
  await dock().getByText("Something went wrong. Please try again later.").waitFor();
  expect(asked()).toBe(once);
  await dock().getByRole("button", { name: "Close" }).click();
});

test("A search full of Space cards loads X's next page only for the reader's scroll: opening Spaces, X's pages for them and Back load none", async () => {
  const pages = () =>
    e.mock.reads.filter(
      (r) => r.op === "SearchTimeline" && r.variables.rawQuery === "filter:spaces",
    ).length;
  await go(`/search?q=${encodeURIComponent("filter:spaces")}&f=latest`);
  const cards = e.app.locator('main [data-x="space-card"]');
  await expect.poll(() => cards.count()).toBeGreaterThan(1);
  const first = pages();
  // The bench's steps: a card, its dock, X's own page for the Space and Back, a second card.
  for (const id of [LIVE_SPACE, GONE_SPACE]) {
    await e.app.locator(`main [data-x="space-card"][data-space-id="${id}"]`).first().click();
    await dock().waitFor();
    await e.engine(
      `(history.pushState(null, "", "/i/spaces/${id}/peek"), dispatchEvent(new PopStateEvent("popstate", { state: null })), true)`,
    );
    await expect.poll(enginePath).toBe(`/i/spaces/${id}/peek`);
    await e.engine("history.back(), true");
    await expect.poll(enginePath).toContain("/search");
  }
  // X's Space cards keep polling, resizing as their Spaces load or fail. Once the steps are done,
  // X loads no page Xtend's list did not ask for, however long that goes on; and a handful at most.
  // (X may fetch once more to fill its own screen as its cards shrink, then it stops.)
  const polls = () => e.mock.reads.filter((r) => r.op === "AudioSpaceById").length;
  const ours = () => e.engine<number>("window.__xtendScroll ?? 0");
  const rounds = async (n: number) => {
    const at = polls();
    await expect.poll(polls, { timeout: 20_000 }).toBeGreaterThan(at + n);
  };
  await rounds(8);
  const settled = { pages: pages(), asks: await ours() };
  await rounds(12);
  expect([pages(), await ours()]).toEqual([settled.pages, settled.asks]);
  expect(pages() - first).toBeLessThanOrEqual(4);
  await dock().getByRole("button", { name: "Close" }).click();
});

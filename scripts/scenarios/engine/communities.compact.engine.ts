import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * A Community's admin flows with mock X in X's compact layout, as a narrow engine window gets
 * it: X's flows and sheets are pages of their own, not dialogs, so Xtend can only tell X is done
 * by where X's page is.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ compact: true });
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname + location.search");
const engineHas = (selector: string) =>
  e.engine<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
const xtendHash = () => e.app.evaluate(() => location.hash);
const pane = () => e.app.locator('section[aria-label="x.com"]').getAttribute("data-mode");

test("compact X: Create's form and X's summary are pages, over the main area until X's Got it", async () => {
  await go("/communities");
  await expect.poll(enginePath).toBe(`/${e.mock.state.viewer.handle}/communities`);
  await expect.poll(() => engineHas('[aria-label="Create a new Community"]')).toBe(true);
  await e.app.locator("main").getByRole("button", { name: "Create a new Community" }).click();
  await expect.poll(enginePath).toBe("/i/communities/create");
  await expect.poll(pane).toBe("main");
  expect(await engineHas('[role="dialog"]')).toBe(false);
  await e.engine(
    `(() => { document.querySelector('[name="name"]').value = "Bootstrapped SaaS"; document.querySelector('[data-x-save="CreateCommunity"]').click(); return true; })()`,
  );
  // X's summary is the new Community's page with no dialog: still X's, over the main area.
  await expect.poll(enginePath).toMatch(/^\/i\/communities\/\d+\?show_creation_summary$/);
  const made = (await enginePath())!.split("/")[3]!.split("?")[0]!;
  await expect.poll(() => engineHas("[data-x-got-it]")).toBe(true);
  expect(await engineHas('[role="dialog"]')).toBe(false);
  // While X's summary is up, Xtend stays off the new Community, look after look.
  let looks = 0;
  await expect
    .poll(
      async () =>
        (await pane()) === "main" && (await engineHas("[data-x-got-it]")) ? ++looks : -1,
      { interval: 100 },
    )
    .toBeGreaterThan(15);
  await e.engine(`document.querySelector('[data-x-got-it]').click(), true`);
  await expect.poll(pane).toBe("hidden");
  // The Community, on the tab X opened it on.
  await expect.poll(xtendHash).toMatch(new RegExp(`^#/communities/${made}(\\?tab=\\w+)?$`));
  await e.app
    .locator('main [data-x="community-checklist"]')
    .getByText("Review your rules")
    .waitFor();
});

test("compact X: a setting's edit is X's page over the main area until X is back on Settings", async () => {
  const id = "600000000103";
  const community = e.mock.state.community(id)!;
  e.mock.state.setCommunityRole(id, "Admin");
  try {
    await go(`/communities/${id}`);
    await expect.poll(enginePath).toBe(`/i/communities/${id}`);
    await e.engine("setTimeout(() => location.reload()), true");
    await e.app.locator("main").getByRole("link", { name: "Admin tools" }).waitFor();
    await go(`/communities/${id}/tools/settings`);
    await expect.poll(enginePath).toBe(`/i/communities/${id}/tools/settings`);
    const settings = e.app.locator('main [data-x="community-settings"]');
    await settings.getByRole("button", { name: /^Purpose/ }).click();
    await expect.poll(enginePath).toBe(`/i/communities/${id}/tools/settings/purpose`);
    await expect.poll(pane).toBe("main");
    await e.engine(
      `(() => { document.querySelector('[name="description"]').value = "Numbers only."; document.querySelector('[data-x-save]').click(); return true; })()`,
    );
    await expect.poll(pane).toBe("hidden");
    await settings.getByText("Numbers only.").waitFor();
  } finally {
    e.mock.state.resetCommunity(id);
    e.mock.state.setCommunityRole(id, community.role);
  }
});

test("compact X: Hide on a reported post is X's rule picker as a page, and X's decision takes the row", async () => {
  const id = "600000000104";
  const community = e.mock.state.community(id)!;
  e.mock.state.setCommunityRole(id, "Admin");
  try {
    await go(`/communities/${id}`);
    await expect.poll(enginePath).toBe(`/i/communities/${id}`);
    await e.engine("setTimeout(() => location.reload()), true");
    await e.app.locator("main").getByRole("link", { name: "Admin tools" }).waitFor();
    await go(`/communities/${id}/moderation/reported_tweets`);
    await expect.poll(enginePath).toBe(`/i/communities/${id}/moderation/reported_tweets`);
    const cases = e.app.locator('main [data-x="report-case"]');
    const [first] = e.mock.state.reportCases(id);
    // X's first page; the rest only as the reader scrolls.
    await expect.poll(() => cases.count()).toBe(2);
    const hidden = e.app.locator(
      `main [data-x="report-case"] article[data-post="${first!.postId}"]`,
    );
    expect(await hidden.count()).toBe(1);
    await cases.first().getByRole("button", { name: "Hide" }).click();
    await expect.poll(enginePath).toBe(`/i/report/hidetweet/${first!.postId}`);
    expect(await engineHas('[role="dialog"]')).toBe(false);
    await expect.poll(pane).toBe("main");
    await e.engine(`document.querySelector('[data-hide-rule]').click(), true`);
    await expect.poll(pane).toBe("hidden");
    await expect.poll(() => hidden.count()).toBe(0);
  } finally {
    e.mock.state.resetCommunity(id);
    e.mock.state.setCommunityRole(id, community.role);
  }
});

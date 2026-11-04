import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * X's settings under Xtend's Settings, with mock X as the engine: a page draws what X's page
 * draws, a click presses X's own control, and X's own pages show over the main area.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine();
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname");
const pane = () => e.app.locator('section[aria-label="x.com"]').getAttribute("data-mode");
const writes = () => e.mock.state.presses.filter((p) => p.kind === "write").map((p) => p.name);

test("X's Privacy and safety reads X's page; Protect your posts presses X's checkbox, and X's confirm shows over the main area until answered", async () => {
  await go("/settings?tab=x-privacy");
  const main = e.app.locator("main");
  await main.getByRole("button", { name: /Audience, media and tagging/ }).click();
  await expect.poll(enginePath).toBe("/settings/audience_and_tagging");
  const protect = main.getByRole("checkbox", { name: /Protect your posts/ });
  await expect.poll(() => protect.isChecked()).toBe(false);
  await main.getByText("Anyone can tag you").waitFor();

  await protect.click();
  // X asks first, on its own sheet: nothing is saved until the user answers there.
  await expect.poll(pane).toBe("main");
  expect(writes()).toEqual([]);
  await e.engine(
    `document.querySelector('[data-testid="confirmationSheetConfirm"]').click(), true`,
  );
  await expect.poll(pane).toBe("hidden");
  await expect.poll(() => protect.isChecked()).toBe(true);
  expect([writes(), e.mock.state.settings.protected]).toEqual([["account/settings"], true]);
  // The rail's log notes the flip as the user's, from what X's page drew after it.
  await expect
    .poll(() =>
      main.locator("li", { hasText: "Protect your posts" }).filter({ hasText: "Off → On" }).count(),
    )
    .toBe(1);
  await main
    .getByText(/in Xtend/)
    .first()
    .waitFor({ state: "attached" });
});

test("At the engine's width beside Xtend's panel, X draws its compact settings page, and Xtend reads it the same", async () => {
  await go("/settings?tab=x-notifications&x=%2Fsettings%2Fnotifications%2Fadvanced_filters");
  await expect.poll(enginePath).toBe("/settings/notifications/advanced_filters");
  // The engine sits at the side panel's width: X's compact layout, with no labelled detail section.
  expect(await e.engine<number>("innerWidth")).toBeLessThan(1000);
  await expect
    .poll(() => e.engine<number>(`document.querySelectorAll('main input[type="checkbox"]').length`))
    .toBe(6);
  expect(
    await e.engine<boolean>(`!!document.querySelector('[aria-labelledby="detail-header"]')`),
  ).toBe(false);
  const main = e.app.locator("main");
  await expect.poll(() => main.getByRole("checkbox").count()).toBe(6);
  await main.getByRole("heading", { name: "Muted notifications" }).waitFor();
  await main.getByText("Mute notifications from people:").waitFor();
  await main
    .getByText("These filters won’t affect notifications from people you follow.")
    .waitFor();
});

test("Muted notifications draws X's six filters with X's values, and each click saves through X's own page", async () => {
  await go("/settings?tab=x-notifications&x=%2Fsettings%2Fnotifications%2Fadvanced_filters");
  const main = e.app.locator("main");
  const newAccount = main.getByRole("checkbox", { name: "With a new account" });
  await expect.poll(() => newAccount.isChecked()).toBe(true);
  expect(await main.getByRole("checkbox").count()).toBe(6);
  await newAccount.click();
  await expect.poll(() => newAccount.isChecked()).toBe(false);
  expect(e.mock.state.settings.filter_new_users).toBe(false);
  expect(writes().at(-1)).toBe("mutes/advanced_filters");
});

test("Password stays X's own page over the main area under Xtend's bar, and its Back returns to the native page", async () => {
  await go("/settings?tab=x-account");
  const main = e.app.locator("main");
  await main.getByRole("button", { name: /Change your password/ }).click();
  await expect.poll(pane).toBe("main");
  expect(await enginePath()).toBe("/settings/password");
  const bar = e.app.locator('section[aria-label="x.com"]');
  await bar.getByText("Change your password").waitFor();
  await bar.getByRole("button", { name: "Back" }).click();
  await expect.poll(pane).toBe("hidden");
  // Back returns the engine to the page the user came from, read again from there.
  await expect.poll(enginePath).toBe("/settings/account");
  await main.getByRole("button", { name: /Deactivate your account/ }).waitFor();
  // Account information asks for the password first, on X's own page.
  await main.getByRole("button", { name: /Account information/ }).click();
  await expect.poll(pane).toBe("main");
  expect(await enginePath()).toBe("/settings/your_twitter_data/account");
});

test("Opening a page X keeps from another screen shows X's page over the main area, and it stays there", async () => {
  await go("/home");
  await expect.poll(enginePath).toBe("/home");
  await go("/settings?tab=x-account&x=%2Fsettings%2Fpassword");
  await expect.poll(enginePath).toBe("/settings/password");
  // Past the screen change's own reset: X's page is still the one in view.
  await e.app.locator('section[aria-label="x.com"]').getByText("Password reset").waitFor();
  expect(await pane()).toBe("main");
});

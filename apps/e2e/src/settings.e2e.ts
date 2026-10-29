import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

test("settings: handle, budget and treg token save, and the sidebar meter follows the budget", async () => {
  const { page, rpc } = app;
  await page.goto("/settings?tab=account");

  // Fields are named by their label and hint; the accounts form below has a bare "Handle".
  await page.getByRole("textbox", { name: /^Handle / }).fill("shipper");
  // Pages share one unsaved draft, so the handle survives the move to Money.
  await page.getByRole("link", { name: "Money" }).click();
  // A password field has no textbox role; its label still names it (label and hint run together).
  const token = page.getByLabel(/^treg token/);
  await token.fill("treg-e2e-token");
  await page.getByRole("spinbutton", { name: /^Monthly budget/ }).fill("30");
  await page.getByRole("button", { name: "Save" }).click();

  // The token is write-only: the field empties and only says one is stored.
  await page.getByLabel(/^treg token ?A token is stored/).waitFor();
  expect(await token.inputValue()).toBe("");
  await page.getByRole("link").filter({ hasText: "$0.00 / $30" }).waitFor();
  await page.getByText("@shipper", { exact: true }).waitFor();

  await page.reload();
  await expect
    .poll(() => page.getByRole("spinbutton", { name: /^Monthly budget/ }).inputValue())
    .toBe("30");
  await page.getByRole("link", { name: "Account" }).click();
  expect(await page.getByRole("textbox", { name: /^Handle / }).inputValue()).toBe("shipper");

  const settings = await rpc("settings.get", {});
  expect(settings).toMatchObject({ handle: "shipper", monthlyBudgetUsd: 30, tregTokenSet: true });
  expect((await rpc("spend.summary", {})).monthlyBudgetUsd).toBe(30);
});

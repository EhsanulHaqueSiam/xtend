import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, choose, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

test("automate: a scheduled notify rule saves as a dry run and the editor keeps what was saved", async () => {
  const { page, rpc, treg } = app;
  await page.goto("/automate");
  await page.getByRole("button", { name: "New rule" }).first().click();

  const editor = page.getByRole("complementary", { name: "New rule" });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Monday reminder");
  await choose(editor.getByRole("combobox", { name: "Trigger" }), "Schedule");
  await editor.getByRole("button", { name: "Thu" }).click();
  await editor.getByRole("textbox", { name: "Time" }).fill("07:30");
  await choose(editor.getByRole("combobox", { name: "Action" }), "Notify me");
  await editor.getByRole("textbox", { name: "Message, {name}" }).fill("Write the weekly thread");
  // New rules start as a dry run; it stays on.
  const dryRun = editor.getByRole("switch", { name: "Dry run, charge nothing" });
  expect(await dryRun.getAttribute("aria-checked")).toBe("true");
  await editor.getByRole("button", { name: "Create rule" }).click();

  // The editor restarts from the stored rule, under its name, with nothing left to save.
  const saved = page.getByRole("complementary", { name: "Monday reminder" });
  await saved.getByRole("button", { name: "Save" }).waitFor();
  expect(await saved.getByRole("button", { name: "Save" }).isDisabled()).toBe(true);
  expect(await saved.getByRole("textbox", { name: "Name", exact: true }).inputValue()).toBe(
    "Monday reminder",
  );
  expect(await saved.getByRole("combobox", { name: "Trigger" }).innerText()).toBe("Schedule");
  expect(await saved.getByRole("button", { name: "Mon" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(await saved.getByRole("button", { name: "Thu" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(await saved.getByRole("textbox", { name: "Time" }).inputValue()).toBe("07:30");
  expect(await saved.getByRole("combobox", { name: "Action" }).innerText()).toBe("Notify me");
  expect(await saved.getByRole("textbox", { name: "Message, {name}" }).inputValue()).toBe(
    "Write the weekly thread",
  );
  expect(
    await saved
      .getByRole("switch", { name: "Dry run, charge nothing" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await page.getByRole("row", { name: /Monday reminder/ }).waitFor();

  expect(await rpc("automate.rulesList", {})).toMatchObject([
    {
      name: "Monday reminder",
      enabled: false,
      dryRun: true,
      trigger: { kind: "schedule", weekdays: [1], time: "07:30" },
      action: { kind: "notify", message: "Write the weekly thread" },
    },
  ]);
  expect(treg.calls).toEqual([]);
});

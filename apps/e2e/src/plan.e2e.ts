import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

test("plan: a new slot takes a draft from the calendar's menu and the draft is queued", async () => {
  const { page, rpc, treg } = app;
  await rpc("compose.draftCreate", { blocks: [{ text: "Weekly build log" }] });
  await page.goto("/plan");

  await page.getByRole("link", { name: "Slots", exact: true }).click();
  await page.getByRole("button", { name: "Add slot" }).click();
  // The added slot is the one not on Sundays: it starts on weekdays only.
  const added = page
    .getByRole("row")
    .filter({ has: page.getByRole("checkbox", { name: "Sun", checked: false }) });
  await added.getByRole("textbox", { name: "Slot time" }).fill("21:45");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("status").filter({ hasText: "Saved 4 slots" }).waitFor();
  const { slots } = await rpc("plan.slotsGet", {});
  expect(slots).toContainEqual(
    expect.objectContaining({ minuteOfDay: 21 * 60 + 45, weekdayMask: 62 }),
  );

  // Next week, so every one of its slots is still ahead whatever day the suite runs.
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  const monday = page.getByRole("region", { name: /^Mon / });
  await monday.getByRole("button", { name: "21:45 open slot" }).click();
  // Filling a slot queues a paid post, so the menu prices the draft before it is picked.
  const pick = page.getByRole("menuitem", { name: /Weekly build log/ });
  expect(await pick.innerText()).toContain("$0.015");
  await pick.click();

  await page.getByRole("status").filter({ hasText: 'Scheduled "Weekly build log"' }).waitFor();
  await monday.getByRole("button", { name: /21:45 Weekly build log/ }).waitFor();
  await page.getByRole("link", { name: "Queue", exact: true }).click();
  await page
    .getByRole("row", { name: /Weekly build log/ })
    .getByRole("button", { name: "Post now" })
    .waitFor();

  const { drafts } = await rpc("compose.draftsList", {});
  expect(drafts).toMatchObject([{ status: "queued" }]);
  // Queueing is free; the post is paid for when its slot comes.
  expect(treg.calls).toEqual([]);
});

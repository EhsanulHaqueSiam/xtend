import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, CHARGE, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

test("compose: a two-post thread autosaves, shows its price, posts in order and moves the meter", async () => {
  const { page, rpc, treg } = app;
  // No desktop here, so the session lane is off and Post now goes through the priced API.
  await rpc("settings.update", { sessionPostingEnabled: false });
  await page.goto("/compose");
  await page.getByRole("button", { name: "New draft" }).first().click();
  await page.getByRole("textbox", { name: "Post 1" }).fill("Ship small, every day.");
  await page.getByRole("button", { name: "Add post", exact: true }).click();
  await page.getByRole("textbox", { name: "Post 2" }).fill("Then tell people what shipped.");

  // Autosave: the service holds the thread without anyone pressing save.
  await expect
    .poll(async () => (await rpc("compose.draftsList", {})).drafts.map((d) => d.blocks))
    .toEqual([[{ text: "Ship small, every day." }, { text: "Then tell people what shipped." }]]);

  await page.getByRole("button", { name: "Post now" }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByText("Post 2 posts now.").waitFor();
  // Two text posts at the rate card's $0.015, quoted before anything is charged.
  expect(await confirm.getByRole("definition").last().innerText()).toBe("$0.03");
  expect(treg.calls).toEqual([]);
  await confirm.getByRole("button", { name: "Confirm and post" }).click();

  await page.getByRole("status").filter({ hasText: "Posted 2 posts" }).waitFor();
  const [first, second] = treg.calls;
  expect(treg.calls).toHaveLength(2);
  expect(first).toEqual({
    method: "POST",
    endpoint: "x/2/tweets",
    body: { text: "Ship small, every day." },
  });
  // Checked against the ids X returned, not the app's own record, so both cannot be wrong together.
  const { drafts } = await rpc("compose.draftsList", {});
  expect(drafts[0]).toMatchObject({ status: "posted", postIds: treg.posted });
  expect(second).toEqual({
    method: "POST",
    endpoint: "x/2/tweets",
    body: {
      text: "Then tell people what shipped.",
      reply: { in_reply_to_tweet_id: treg.posted[0] },
    },
  });
  // The meter shows what treg billed, not the $0.03 quote.
  await page
    .getByRole("link")
    .filter({ hasText: `$${(2 * CHARGE.post).toFixed(2)} / $50` })
    .waitFor();

  await page.getByRole("button", { name: "Back to Posted" }).click();
  await page
    .getByRole("row", { name: /Ship small, every day\./ })
    .getByRole("button", { name: "View on X" })
    .waitFor();
});

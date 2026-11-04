import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's Grok on the desktop, with mock X's Grok page (bundle.GrokXWeb's markup) as the engine:
 * Xtend reads X's page and presses only X's own controls, for the user's clicks.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ premium: false });
});
afterAll(() => e?.close());

const enginePath = () => e.engine<string>("location.pathname");
const rail = (engine = e) => engine.app.getByRole("complementary", { name: "Grok rail" });
const rows = (engine = e) => rail(engine).locator('[data-x="grok-history-row"]');

test("Grok lists X's history in the rail from X's own panel and opens a chat only in X's router", async () => {
  const { grok } = e.mock.state;
  await e.app.getByRole("button", { name: "Grok", exact: true }).click();
  await expect.poll(enginePath).toBe("/i/grok");
  await expect.poll(() => rows().count()).toBe(grok.conversations.length);
  expect(await rows().allTextContents()).toEqual(
    grok.conversations.map((c) => expect.stringContaining(c.title)),
  );
  // Reading X's history changed nothing in X.
  expect(grok.writes).toEqual([]);

  await rows().filter({ hasText: "Two-plan pricing arguments" }).locator("button").first().click();
  await expect.poll(enginePath).toBe("/i/grok/c/c-pricing");
  await e.app
    .getByText("What are founders saying about two-plan pricing pages this week?")
    .waitFor();
  await e.app.getByText("For two plans").waitFor();
  // The people Grok named, with the user's own Track for them; nothing is sent to Grok for it.
  const named = e.app.getByRole("region", { name: "In this answer" });
  await named.getByRole("link", { name: "@jonpark" }).waitFor();
  await named.getByRole("link", { name: "@lenaw" }).waitFor();
  expect(grok.writes).toEqual([]);
});

test("asking types into X's own composer and presses X's Send; X's streamed answer shows once X draws it", async () => {
  const { grok } = e.mock.state;
  const box = e.app.getByRole("textbox", { name: "Ask Grok" });
  await box.fill("Who is quoting this?");
  expect(grok.writes).toEqual([]);
  await e.app.getByRole("button", { name: "Send", exact: true }).click();
  await e.app.getByText("Who is quoting this?").waitFor();
  await e.app.getByText("Replies split between people").waitFor();
  expect(grok.writes).toEqual(["send t-c-pricing-2"]);
  expect(await box.inputValue()).toBe("");

  // X's Good response on X's answer, and X's model menu: X's list, X's pick.
  await e.app
    .locator('[data-x="grok-answer"]')
    .last()
    .getByRole("button", { name: "Good response" })
    .click();
  await expect.poll(() => grok.writes.at(-1)).toBe("feedback t-c-pricing-2");
  await e.app.getByRole("button", { name: "Auto" }).click();
  await e.app.getByRole("menuitem", { name: /Heavy.*Upgrade/ }).waitFor();
  await e.app.getByRole("menuitem", { name: /^Fast/ }).click();
  await expect.poll(() => grok.writes.at(-1)).toBe("model Fast");
  await e.app.getByRole("button", { name: "Fast" }).waitFor();
});

test("Pin, Rename and Delete in the rail press X's own row controls, Delete only after its confirm", async () => {
  const { grok } = e.mock.state;
  const row = (title: string) => rows().filter({ hasText: title });
  await row("Explain this post: churn email").hover();
  await row("Explain this post: churn email").getByRole("button", { name: "Pin" }).click();
  await expect.poll(() => grok.writes.at(-1)).toBe("pin c-churn");
  await expect.poll(() => grok.conversations.find((c) => c.id === "c-churn")?.starred).toBe(true);

  await row("Weekly niche recap").hover();
  await row("Weekly niche recap").getByRole("button", { name: "Rename" }).click();
  await rail().getByRole("textbox", { name: "Rename" }).fill("Niche recap");
  await rail().getByRole("textbox", { name: "Rename" }).press("Enter");
  await expect.poll(() => grok.writes.at(-1)).toBe("rename c-recap");
  await row("Niche recap").waitFor();

  const before = grok.writes.length;
  await row("Niche recap").hover();
  await row("Niche recap").getByRole("button", { name: "Delete" }).click();
  expect(grok.writes.length).toBe(before);
  await row("Niche recap").getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => grok.writes.at(-1)).toBe("delete c-recap");
  await expect.poll(() => rows().count()).toBe(grok.conversations.length);
});

test("past X's free limit, X's own SuperGrok upsell shows in place of the answer, with X's upgrade link", async () => {
  const limited = await startEngine({ premium: false, grokLimited: true });
  try {
    await limited.app.evaluate(() => void (location.hash = "#/grok"));
    await expect.poll(() => limited.engine<string>("location.pathname")).toBe("/i/grok");
    await limited.app.getByRole("textbox", { name: "Ask Grok" }).fill("Summarize my week");
    await limited.app.getByRole("button", { name: "Send", exact: true }).click();
    await limited.app.getByText("You have reached your Grok usage limit").waitFor();
    // X's upgrade page opens in X's own page, where X shows its price.
    await limited.app.getByRole("button", { name: "Upgrade to SuperGrok" }).click();
    await expect.poll(() => limited.engine<string>("location.pathname")).toBe("/i/premium_sign_up");
    expect(limited.mock.state.grok.writes).toEqual(["send t-c-new1-1"]);
  } finally {
    await limited.close();
  }
});

test("in X's compact layout, the rail reads X's History page and X goes Back to the chat", async () => {
  const compact = await startEngine({ premium: false, compact: true });
  try {
    const { grok } = compact.mock.state;
    await compact.app.evaluate(() => void (location.hash = "#/grok?c=c-pricing"));
    await expect
      .poll(() => compact.engine<string>("location.pathname"))
      .toBe("/i/grok/c/c-pricing");
    await expect.poll(() => rows(compact).count()).toBe(grok.conversations.length);
    // X went to its History page for the read and came Back to the chat open in Xtend.
    await expect
      .poll(() => compact.engine<string>("location.pathname"))
      .toBe("/i/grok/c/c-pricing");
    await compact.app
      .getByText("What are founders saying about two-plan pricing pages this week?")
      .waitFor();
    const row = rows(compact).filter({ hasText: "Explain this post: churn email" });
    await row.hover();
    await row.getByRole("button", { name: "Pin" }).click();
    await expect.poll(() => grok.writes.at(-1)).toBe("pin c-churn");
    await expect
      .poll(() => compact.engine<string>("location.pathname"))
      .toBe("/i/grok/c/c-pricing");
  } finally {
    await compact.close();
  }
});

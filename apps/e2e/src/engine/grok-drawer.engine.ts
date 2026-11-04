import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's docked Grok on the desktop, with mock X (bundle.GrokXWeb's markup) as the engine:
 * Explain this post presses X's own Grok button on the post, Compose's Ask Grok types the draft
 * only into Xtend's box, and X's images come from X's own page.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ premium: false });
  await e.app.setViewportSize({ width: 1500, height: 900 });
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname");
const drawer = () => e.app.getByRole("region", { name: "Grok", exact: true });

test("Explain this post presses X's own Grok button on the post and docks X's answer beside the screen", async () => {
  const { grok } = e.mock.state;
  await go("/home");
  await expect.poll(enginePath).toBe("/home");
  const first = e.app.locator('main [data-x="post"]').first();
  await first.waitFor();
  const id = await first.getAttribute("data-post");
  await first.getByRole("button", { name: "Explain this post" }).click();
  await expect.poll(() => grok.writes.at(-1)).toMatch(new RegExp(`^analyze \\w+/status/${id}$`));
  await expect.poll(enginePath).toBe("/i/grok");
  await drawer().getByText("Replies split between people").waitFor();
  // Closing it takes the engine back to the page the screen shows.
  await drawer().getByRole("button", { name: "Close Grok" }).click();
  await expect.poll(enginePath).toBe("/home");
  await expect.poll(() => drawer().count()).toBe(0);
});

test("X's images show as X's page draws them, in the answer and in X's Media tab", async () => {
  await go("/grok");
  const rail = e.app.getByRole("complementary", { name: "Grok rail" });
  await rail.getByRole("button", { name: "Cover image ideas" }).click();
  await expect.poll(enginePath).toBe("/i/grok/c/c-images");
  const picture = e.app.locator('main [data-x="grok-answer"] img[alt="A city under twin moons"]');
  await expect.poll(() => picture.getAttribute("src")).toMatch(/^data:image\/jpeg/);
  await rail.getByRole("tab", { name: "Media" }).click();
  await expect.poll(() => rail.locator("ul.grid img").count()).toBe(1);
  expect(await rail.locator("ul.grid img").getAttribute("src")).toMatch(/^data:image\/jpeg/);
});

test("Ask Grok types the draft into Xtend's box only; Grok's answer goes into the draft on Insert", async () => {
  const { grok } = e.mock.state;
  await go("/compose?new=1");
  const post = e.app.getByRole("textbox", { name: "Post 1" });
  await post.fill("Shipping on Fridays is fine if rollback is one click.");
  await e.app.getByRole("button", { name: /Ask Grok/ }).click();
  const box = drawer().getByRole("textbox", { name: "Ask Grok" });
  await expect
    .poll(() => box.inputValue())
    .toBe("Shipping on Fridays is fine if rollback is one click.");
  const before = grok.writes.length;
  await box.fill("Make this punchier: Shipping on Fridays is fine if rollback is one click.");
  expect(grok.writes.length).toBe(before);
  await drawer().getByRole("button", { name: "Send", exact: true }).click();
  await drawer().getByText("Replies split between people").waitFor();
  expect(grok.writes.slice(before)).toEqual([expect.stringMatching(/^send t-c-new\d+-1$/)]);
  await drawer().getByRole("button", { name: "Insert" }).click();
  await expect.poll(() => post.inputValue()).toMatch(/^Replies split between people/);
});

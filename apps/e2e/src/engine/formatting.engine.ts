import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * X's bold and italic for an account X lets format, told by X's composer alone (mock X sends no
 * claim for it): posts draw X's formatting, and Home's box applies it through X's own composer,
 * with X's own command keys, on the click that posts.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ formatting: true });
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname + location.search");

test("a long post draws X's bold and italic, and Home's box posts them through X's composer", async () => {
  await go("/home?feed=forYou");
  await expect.poll(enginePath).toBe("/home");
  const main = e.app.locator("main");
  await main.locator("article b", { hasText: "landing page headline" }).first().waitFor();
  await main.locator("article i", { hasText: "80% of the work" }).first().waitFor();

  const box = e.app.getByLabel("Post text");
  await box.click();
  await box.pressSequentially("go big now");
  const select = (start: number, end: number) =>
    box.evaluate(
      (el, [s, t]) => (el as HTMLTextAreaElement).setSelectionRange(s!, t!),
      [start, end],
    );
  await select(3, 6);
  const bold = e.app.getByRole("button", { name: "Bold", exact: true });
  await bold.click();
  await expect.poll(() => bold.getAttribute("aria-pressed")).toBe("true");
  await select(7, 10);
  await e.app.getByRole("button", { name: "Italic", exact: true }).click();

  await e.app.getByRole("button", { name: "Post", exact: true }).click();
  await e.app.getByText("Posted on X").waitFor();
  // X's own keys on X's composer, then X's long-post create with the runs as richtext_tags.
  const presses = e.mock.state.presses.map((p) => `${p.kind} ${p.name}`);
  expect(presses).toEqual(
    expect.arrayContaining([
      "press composer:Bold on",
      "press composer:Bold off",
      "press composer:Italic on",
      "press tweetButton",
      "write CreateNoteTweet",
    ]),
  );
  // X answered with the post it made, which Home draws on top with X's formatting.
  await main.locator("article b", { hasText: /^big$/ }).first().waitFor();
  await main.locator("article i", { hasText: /^now$/ }).first().waitFor();
});

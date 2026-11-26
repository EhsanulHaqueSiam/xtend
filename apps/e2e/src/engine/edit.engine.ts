import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * X Premium's Edit post on the user's own post, inside X's hour: Xtend's press of X's Edit row
 * turns the post's text into an editor in place, and Update edits it through X's own Edit row and
 * composer in the session, after which the post shows X's new version.
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ formatting: true });
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname + location.search");
const presses = (from: number) =>
  e.mock.state.presses.slice(from).map((p) => `${p.kind} ${p.name} ${p.target ?? ""}`.trim());

test("Update edits the user's own post through X's Edit row and composer, and the post shows X's new version", async () => {
  await go("/home?feed=forYou");
  await expect.poll(enginePath).toBe("/home");
  const main = e.app.locator("main");
  // A post of the user's own, made now, so X's menu offers Edit post on it.
  await e.app.getByLabel("Post text").fill("first take");
  await e.app.getByRole("button", { name: "Post", exact: true }).click();
  await e.app.getByText("Posted on X").waitFor();
  const id = await main
    .locator("article", { hasText: "first take" })
    .first()
    .getAttribute("data-post");
  // By id: the editor's text changes what the article says.
  const mine = main.locator(`article[data-post="${id}"]`);

  const before = e.mock.state.presses.length;
  await mine.locator('button[aria-label="More"]').click();
  await e.app.getByRole("menuitem", { name: "Edit post", exact: true }).click();
  const box = mine.getByRole("textbox", { name: "Edit post text" });
  await expect.poll(() => box.inputValue()).toBe("first take");
  // Opening the editor pressed none of X's rows: Update presses X's Edit post.
  expect(presses(before).filter((p) => p.startsWith("press row:"))).toEqual([]);
  await box.fill("second take");
  await mine.getByRole("button", { name: "Update" }).click();

  await main
    .locator("article", { hasText: "second take" })
    .first()
    .getByText(/^Last edited /)
    .waitFor();
  await expect.poll(() => main.locator("article", { hasText: "first take" }).count()).toBe(0);
  // X's own Edit post row on the post, its composer, and X's create naming the version it replaces.
  expect(presses(before)).toEqual(
    expect.arrayContaining([
      `press row:Edit post post:${id}`,
      "press tweetButton",
      `write CreateTweet ${id}`,
    ]),
  );
  const order = (name: string) => presses(before).findIndex((p) => p.startsWith(name));
  expect(order("press row:Edit post")).toBeLessThan(order("press tweetButton"));
  expect(order("press tweetButton")).toBeLessThan(order("write CreateTweet"));
});

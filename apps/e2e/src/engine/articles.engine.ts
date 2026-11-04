import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

/**
 * Xtend's Articles on the desktop, with mock X's Articles as the engine: X's list read off X's own
 * page, X's "Page not found" for an account without Premium, and Publish now through X's own
 * editor for the user's click (mock X's editor takes the paste and records X's mutations).
 */

let e: Engine;
beforeAll(async () => {
  e = await startEngine({ premium: false });
  // Publish now goes through the session only while session actions are on.
  await e.service.rpc("settings.update", { sessionPostingEnabled: true });
  await e.app.reload();
});
afterAll(() => e?.close());

const go = (route: string) => e.app.evaluate((hash) => void (location.hash = hash), `#${route}`);
const enginePath = () => e.engine<string>("location.pathname");
const main = () => e.app.locator("main");
const writes = () => e.mock.state.presses.filter((p) => p.kind === "write").map((p) => p.name);

test("Without Premium X answers its Articles page with Not found, and Xtend shows X's upsell", async () => {
  await e.app.getByRole("button", { name: "Articles", exact: true }).click();
  await expect.poll(enginePath).toBe("/compose/articles");
  await expect.poll(() => main().innerText()).toContain("Publish Articles");
  await expect
    .poll(() => e.app.getByRole("link", { name: "Upgrade to unlock" }).getAttribute("href"))
    .toBe("https://x.com/i/premium_sign_up?referring_page=level_up_content_benefits");
  expect(writes()).toEqual([]);
});

test("X's own drafts list and open read-only; Copy to Xtend makes an Xtend draft of one", async () => {
  e.mock.state.setPremium(true);
  await e.engine("location.reload(), true");
  await go("/compose");
  await e.app.getByRole("button", { name: "Articles", exact: true }).click();
  const draft = e.mock.state.articles.articles.find((a) => a.lifecycle === "Draft")!;
  await main().getByText(draft.title).click();
  await expect.poll(enginePath).toBe(`/compose/articles/edit/${draft.id}/preview`);
  await main().getByText("Hiring the first support person, when to stop.").waitFor();
  await e.app.getByRole("button", { name: "Copy to Xtend" }).click();
  await expect
    .poll(() => e.app.getByLabel("Article Title").inputValue())
    .toBe("Notes from the founders dinner");
  await expect
    .poll(() => e.app.getByRole("textbox", { name: "Article body" }).getAttribute("data-kind"))
    .toBe("heading");
  // Reading and copying typed nothing into X's editor.
  expect(writes()).toEqual([]);
});

test("Publish now goes through X's own editor: X's create, one paste, X's Publish and its dialog", async () => {
  await e.app.getByRole("button", { name: "Articles", exact: true }).click();
  await e.app.getByRole("button", { name: "Write", exact: true }).first().click();
  await e.app.getByLabel("Article Title").fill("Two plans beat three");
  await e.app.getByRole("textbox", { name: "Article body" }).click();
  await e.app.keyboard.type("# Why");
  await e.app.keyboard.press("Enter");
  await e.app.keyboard.type("It worked");
  await e.app.getByRole("button", { name: "Publish", exact: true }).click();
  await e.app
    .getByRole("list", { name: "Ways out" })
    .getByRole("button", { name: /Publish now/ })
    .click();
  await e.app.getByLabel("Choose who can reply to this Article").selectOption("following");
  await e.app.getByLabel("Add a caption to your article").fill("The whole test");
  await e.app.getByRole("button", { name: /^Publish\s*free$/ }).click();
  await e.app.getByText("Success! Your Article has been published").waitFor({ timeout: 60_000 });

  const published = e.mock.state.articles.articles.find((a) => a.title === "Two plans beat three")!;
  expect([published.lifecycle, published.caption, published.replies, published.blocks]).toEqual([
    "Published",
    "The whole test",
    "Community",
    [
      { type: "header-one", text: "Why" },
      { type: "unstyled", text: "It worked" },
    ],
  ]);
  const presses = e.mock.state.presses.map((p) => `${p.kind} ${p.name}`);
  // X's own controls in X's order: one paste of the whole body, one press of each Publish.
  expect(presses.filter((p) => p.startsWith("press article:"))).toEqual([
    "press article:create",
    "press article:paste",
    "press article:publish",
    "press article:confirm",
  ]);
  expect(e.mock.state.presses.find((p) => p.name === "article:paste")?.target).toBe(
    "<h1>Why</h1><p>It worked</p>",
  );
  expect(writes().filter((w) => w === "ArticleEntityPublish")).toHaveLength(1);
  await expect.poll(enginePath).toBe(`/you/status/${published.postId}`);
});

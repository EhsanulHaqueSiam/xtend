import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type App, MOD, SEARCH_HIT, startApp } from "./harness.ts";

let app: App;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());

test("library: the palette fills the search box for free, the priced Search runs once, a result saves", async () => {
  const { page, rpc, treg } = app;
  await page.goto("/seen");
  await page.getByRole("heading", { name: "Seen" }).waitFor();

  await page.keyboard.press(`${MOD}+k`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor();
  await page.keyboard.type("ship daily");
  const option = palette.getByRole("option", { name: 'Search library for "ship daily"' });
  expect(await option.getAttribute("aria-selected")).toBe("true");
  await page.keyboard.press("Enter");

  const query = page.getByRole("textbox", { name: "Search query" });
  await expect.poll(() => query.inputValue()).toBe("ship daily");
  // A link from the palette only fills the box: every search is paid, so it waits for a click.
  expect(treg.calls).toEqual([]);

  const search = page.getByRole("button", { name: "Search $0.00075" });
  await search.click();
  const card = page.getByRole("article").filter({ hasText: SEARCH_HIT.text });
  await card.waitFor();
  expect(treg.calls).toMatchObject([
    { method: "POST", endpoint: "anyapi.x.search.posts", body: { query: "ship daily" } },
  ]);

  await card.getByRole("button", { name: SEARCH_HIT.text }).click();
  const inspector = page.getByRole("complementary", { name: "Selected post" });
  await inspector.getByRole("button", { name: "Save" }).click();
  await page.getByRole("menuitem", { name: "Swipe file" }).click();
  await inspector.getByRole("button", { name: "Saved to Swipe file" }).waitFor();

  await page.getByRole("link", { name: "Swipe file", exact: true }).click();
  await page.getByText("1 saved").waitFor();
  await page.getByRole("article").filter({ hasText: SEARCH_HIT.text }).waitFor();
  const saved = await rpc("library.savedList", {});
  expect(saved.items.map((s) => s.post.postId)).toEqual([SEARCH_HIT.id]);
  // Saving reuses what the search returned; it is not another read.
  expect(treg.calls).toHaveLength(1);
});

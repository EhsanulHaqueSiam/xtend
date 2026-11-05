import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { type Engine, startEngine } from "./harness.ts";

// For you pages on far past what the test reads: only where the engine leaves X's page ends it.
let e: Engine;
beforeAll(async () => {
  e = await startEngine({ forYouPages: 80 });
});
afterAll(() => e?.close());

const nextPages = () =>
  e.mock.reads.filter((r) => r.op === "HomeTimeline" && r.variables.cursor !== undefined).length;
/**
 * X's cells collapse as X redraws them (a Space card X holds no Space for, as X polls it), and X's
 * list checks its end again, `times` over: a page parked at its end stays at its end each time.
 */
const resize = async (times: number) => {
  for (let i = 0; i < times; i++)
    await e.engine(`window.__mockCellsResized(() => {
      for (const a of document.querySelectorAll("article:not([data-shrunk])")) {
        a.dataset.shrunk = "";
        Object.assign(a.style, { minHeight: "0", height: "0", padding: "0", border: "0", overflow: "hidden" });
      }
    })`);
};

test("X's page goes back where it was after the engine asks it for more, so X stops loading by itself", async () => {
  await e.app.evaluate(() => void (location.hash = "#/home?feed=forYou"));
  // The reader reaches the native list's end: the engine scrolls X's page, and X answers.
  await expect
    .poll(async () => {
      await e.app.evaluate(() => {
        const s = document.querySelector("main [data-virtuoso-scroller]");
        if (s !== null) s.scrollTop = s.scrollHeight;
      });
      return nextPages();
    })
    .toBeGreaterThan(0);
  // The reader leaves for a tool: Xtend's list goes, and with it any ask it still had queued. Once
  // the engine's scroll for more is done, X's page is back at the top, where it was, and asks for
  // nothing more however its cells resize.
  await e.app.evaluate(() => void (location.hash = "#/scores"));
  await e.app.locator("main article[data-post]").first().waitFor({ state: "detached" });
  await expect.poll(() => e.engine<boolean>("!window.__xtendScrollLive")).toBe(true);
  expect(await e.engine<string>("location.pathname")).toBe("/home");
  const asked = nextPages();
  await resize(4);
  expect([nextPages(), await e.engine<number>("scrollY")]).toEqual([asked, 0]);

  // Parked at its end, as the engine used to leave it, X's page loads a page per resize.
  await e.engine("scrollTo(0, document.documentElement.scrollHeight), true");
  await resize(4);
  expect(nextPages()).toBeGreaterThanOrEqual(asked + 4);
});

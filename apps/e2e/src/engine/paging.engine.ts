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

test("X's page goes back where it was after the engine asks it for more, so X stops loading by itself", async () => {
  await e.app.evaluate(() => void (location.hash = "#/home?feed=forYou"));
  await expect
    .poll(() => e.engine<number>("document.querySelectorAll('article').length"))
    .toBeGreaterThan(0);
  // X's cells collapse as X redraws them (a Space card X holds no Space for, as X polls it): a
  // page parked at its end stays at its end as each new page lands.
  await e.engine(`(window.__shrink = setInterval(() => {
    for (const a of document.querySelectorAll("article:not([data-shrunk])")) {
      a.dataset.shrunk = "";
      Object.assign(a.style, { minHeight: "0", height: "0", padding: "0", border: "0", overflow: "hidden" });
    }
  }, 150)), true`);
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
  await e.app.evaluate(() => {
    const s = document.querySelector("main [data-virtuoso-scroller]");
    if (s !== null) s.scrollTop = 0;
  });
  // Back at the top, where it was, X's page asks for nothing more however its cells resize.
  let asked = nextPages();
  let still = 0;
  await expect
    .poll(
      async () => {
        const now = nextPages();
        const home = (await e.engine<number>("scrollY")) === 0;
        still = home && now === asked ? still + 1 : 0;
        asked = now;
        return still;
      },
      { interval: 100, timeout: 20_000 },
    )
    .toBeGreaterThan(30);

  // Parked at its end, as the engine used to leave it, X's page loads page after page by itself.
  await e.engine("scrollTo(0, document.documentElement.scrollHeight), true");
  await expect.poll(nextPages).toBeGreaterThan(asked + 3);
  await e.engine("clearInterval(window.__shrink), true");
});

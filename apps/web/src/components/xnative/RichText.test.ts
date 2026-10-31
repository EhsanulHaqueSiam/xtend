import { expect, it } from "vite-plus/test";

import { xtendRoute } from "./RichText";

it("opens x.com posts, profiles and searches in Xtend's own screens, and everything else outside", () => {
  expect(xtendRoute("https://x.com/rauchg/status/123?s=20")).toBe("/post/123?h=rauchg");
  expect(xtendRoute("https://twitter.com/levelsio")).toBe("/u/levelsio");
  expect(xtendRoute("https://x.com/search?q=%23buildinpublic")).toBe("/search?q=%23buildinpublic");
  // X's own pages Xtend does not draw, and other sites, open in the browser.
  expect(xtendRoute("https://x.com/i/spaces/1")).toBeNull();
  expect(xtendRoute("https://x.com/home")).toBeNull();
  expect(xtendRoute("https://levels.io/vps")).toBeNull();
  expect(xtendRoute("not a url")).toBeNull();
});

import { expect, it } from "vite-plus/test";

import { xtendRoute } from "./RichText";

it("opens x.com posts, profiles, searches, the Follow page and Communities in Xtend's own screens, and everything else outside", () => {
  expect(xtendRoute("https://x.com/rauchg/status/123?s=20")).toBe("/post/123?h=rauchg");
  expect(xtendRoute("https://twitter.com/levelsio")).toBe("/u/levelsio");
  expect(xtendRoute("https://x.com/search?q=%23buildinpublic")).toBe("/search?q=%23buildinpublic");
  expect(xtendRoute("https://x.com/i/connect_people?show_topics=false")).toBe("/follow");
  expect(xtendRoute("https://x.com/i/connect_people?is_creator_only=true")).toBe(
    "/follow?tab=creators",
  );
  expect(xtendRoute("https://twitter.com/i/communities/1600000000000000001")).toBe(
    "/communities/1600000000000000001",
  );
  expect(xtendRoute("https://x.com/you/communities/explore")).toBe("/communities?tab=explore");
  expect(xtendRoute("https://x.com/you/communities")).toBe("/communities");
  // X's own pages Xtend does not draw, and other sites, open in the browser.
  expect(xtendRoute("https://x.com/i/spaces/1")).toBeNull();
  expect(xtendRoute("https://x.com/home")).toBeNull();
  expect(xtendRoute("https://levels.io/vps")).toBeNull();
  expect(xtendRoute("not a url")).toBeNull();
});

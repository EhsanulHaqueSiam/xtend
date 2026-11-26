import { expect, it } from "vite-plus/test";

import { xtendRoute } from "./RichText";

it("opens x.com posts, Articles, profiles, searches, the Follow page and Communities in Xtend's own screens, and everything else outside", () => {
  expect(xtendRoute("https://x.com/rauchg/status/123?s=20")).toBe("/post/123?h=rauchg");
  expect(xtendRoute("https://x.com/rauchg/article/124")).toBe("/article/124?h=rauchg");
  expect(xtendRoute("https://twitter.com/levelsio")).toBe("/u/levelsio");
  expect(xtendRoute("https://x.com/search?q=%23buildinpublic")).toBe("/search?q=%23buildinpublic");
  expect(xtendRoute("https://x.com/i/connect_people?show_topics=false")).toBe("/follow");
  expect(xtendRoute("https://x.com/i/connect_people?is_creator_only=true")).toBe(
    "/follow?tab=creators",
  );
  expect(xtendRoute("https://twitter.com/i/communities/1600000000000000001")).toBe(
    "/communities/1600000000000000001",
  );
  expect(xtendRoute("https://x.com/i/communities/1600000000000000001/latest")).toBe(
    "/communities/1600000000000000001?tab=latest",
  );
  expect(xtendRoute("https://x.com/i/communities/1600000000000000001/about?s=20")).toBe(
    "/communities/1600000000000000001?tab=about",
  );
  expect(xtendRoute("https://x.com/i/communities/1600000000000000001/members")).toBeNull();
  // X's Admin tools and General settings are Xtend's; X's other tools and each edit stay X's.
  expect(xtendRoute("https://x.com/i/communities/16/tools")).toBe("/communities/16/tools");
  expect(xtendRoute("https://x.com/i/communities/16/tools/settings")).toBe(
    "/communities/16/tools/settings",
  );
  expect(xtendRoute("https://x.com/i/communities/16/tools/settings/name")).toBeNull();
  expect(xtendRoute("https://x.com/i/communities/16/tools/members")).toBeNull();
  expect(xtendRoute("https://x.com/i/communities/16/moderation/reported_tweets")).toBe(
    "/communities/16/moderation/reported_tweets",
  );
  expect(xtendRoute("https://x.com/i/communities/16/moderation/moderation_log")).toBeNull();
  expect(xtendRoute("https://x.com/you/communities/explore")).toBe("/communities?tab=explore");
  expect(xtendRoute("https://x.com/you/communities")).toBe("/communities");
  // A news story (Explore's news rows link it) and the NBA league page by X's tab.
  expect(xtendRoute("https://x.com/i/trending/1985000000000000001")).toBe(
    "/trending/1985000000000000001",
  );
  expect(xtendRoute("https://x.com/i/trending/1985000000000000001?timeline=VGltZQ%3D%3D")).toBe(
    "/trending/1985000000000000001?timeline=VGltZQ%3D%3D",
  );
  expect(xtendRoute("https://x.com/i/trending/1985000000000000001/history")).toBeNull();
  expect(xtendRoute("https://x.com/i/nba")).toBe("/nba?tab=games");
  expect(xtendRoute("https://x.com/i/nba/standings")).toBe("/nba?tab=standings");
  expect(xtendRoute("https://x.com/i/nba/media")).toBeNull();
  // X's own pages Xtend does not draw, and other sites, open in the browser.
  expect(xtendRoute("https://x.com/home")).toBeNull();
  expect(xtendRoute("https://levels.io/vps")).toBeNull();
  expect(xtendRoute("not a url")).toBeNull();
});

it("opens X's Lists, Spaces, people, profile tabs, post activity, Explore, Notifications and Bookmarks in Xtend", () => {
  expect(xtendRoute("https://x.com/i/lists/77")).toBe("/lists/77");
  expect(xtendRoute("https://x.com/i/lists/77/members")).toBe("/lists/77/people?of=members");
  expect(xtendRoute("https://x.com/i/lists/77/followers")).toBe("/lists/77/people?of=followers");
  expect(xtendRoute("https://x.com/i/spaces/1YqKDqDXAbMKV")).toBe("/spaces/1YqKDqDXAbMKV");
  expect(xtendRoute("https://x.com/rauchg/followers")).toBe("/u/rauchg/people?tab=followers");
  expect(xtendRoute("https://x.com/rauchg/following")).toBe("/u/rauchg/people?tab=following");
  expect(xtendRoute("https://x.com/rauchg/verified_followers")).toBe(
    "/u/rauchg/people?tab=verified_followers",
  );
  expect(xtendRoute("https://x.com/rauchg/with_replies")).toBe("/u/rauchg?tab=replies");
  expect(xtendRoute("https://x.com/rauchg/media")).toBe("/u/rauchg?tab=media");
  expect(xtendRoute("https://x.com/rauchg/status/123/quotes")).toBe(
    "/post/123/activity?h=rauchg&tab=quotes",
  );
  expect(xtendRoute("https://x.com/rauchg/status/123/retweets")).toBe(
    "/post/123/activity?h=rauchg&tab=reposts",
  );
  expect(xtendRoute("https://x.com/rauchg/status/123/likes")).toBe(
    "/post/123/activity?h=rauchg&tab=likes",
  );
  expect(xtendRoute("https://x.com/explore")).toBe("/explore");
  expect(xtendRoute("https://x.com/notifications")).toBe("/notifications");
  expect(xtendRoute("https://x.com/notifications/mentions")).toBe("/notifications?tab=mentions");
  expect(xtendRoute("https://x.com/i/bookmarks")).toBe("/bookmarks");
  // A folder id is all digits, so it goes quoted the way the router writes a numeric-looking string.
  expect(xtendRoute("https://x.com/i/bookmarks/1800000000000000001")).toBe(
    "/bookmarks?folder=%221800000000000000001%22",
  );
  // A post's photo still opens the post; X's own pages under these stay X's.
  expect(xtendRoute("https://x.com/rauchg/status/123/photo/1")).toBe("/post/123?h=rauchg");
  expect(xtendRoute("https://x.com/i/lists/77/info")).toBeNull();
  expect(xtendRoute("https://x.com/rauchg/lists")).toBeNull();
});

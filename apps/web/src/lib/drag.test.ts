import { expect, it } from "vite-plus/test";

import { postFromUrl } from "./drag";

it("reads the post and author out of a status URL", () => {
  expect(postFromUrl("https://x.com/levelsio/status/1980000000000000001?s=20")).toEqual({
    handle: "levelsio",
    postId: "1980000000000000001",
    url: "https://x.com/levelsio/status/1980000000000000001",
  });
  expect(postFromUrl("https://twitter.com/levelsio/status/12")?.postId).toBe("12");
});

it("rejects anything that is not a post", () => {
  expect(postFromUrl("https://x.com/levelsio")).toBeNull();
  expect(postFromUrl("https://x.com/i/bookmarks")).toBeNull();
  expect(postFromUrl("hello")).toBeNull();
});

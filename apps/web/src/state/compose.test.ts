import { expect, it } from "vite-plus/test";

import { followPost } from "./compose";

it("follows the post that asked Grok through the thread: moved, edited in place, or gone", () => {
  const [a, b, c] = [{ text: "one" }, { text: "two" }, { text: "three" }];
  // Asked about post 1; the user then works on post 2: post 1 is still the one.
  expect(followPost([a, b], [a, { text: "two, edited" }], 0)).toBe(0);
  // Its own words changed: still there.
  expect(followPost([a, b], [{ text: "one, edited" }, b], 0)).toBe(0);
  // A post above it went, or it moved: it is where it went.
  expect(followPost([a, b, c], [a, c], 2)).toBe(1);
  expect(followPost([a, b, c], [b, a, c], 0)).toBe(1);
  // A paste split it into several posts: its first is the one.
  expect(followPost([a, b, c], [a, { text: "two, part 1" }, { text: "part 2" }, c], 1)).toBe(1);
  // It was removed: no post is the one any more.
  expect(followPost([a, b, c], [a, c], 1)).toBeNull();
});

import { expect, it } from "vite-plus/test";

import { parseHandle, parsePostId } from "./utils";

it("reads a handle the way people type it and rejects what X would not accept", () => {
  expect(parseHandle("  @levelsio ")).toBe("levelsio");
  expect(parseHandle("Levels_IO")).toBe("Levels_IO");
  expect(parseHandle("")).toBeNull();
  expect(parseHandle("@")).toBeNull();
  expect(parseHandle("some user")).toBeNull();
  expect(parseHandle("a_handle_longer_than_15")).toBeNull();
  expect(parseHandle("x.com/levelsio")).toBeNull();
});

it("takes a post id or the id out of a pasted post URL, never digits from the handle", () => {
  expect(parsePostId("1835124037934367098")).toBe("1835124037934367098");
  expect(parsePostId(" 42 ")).toBe("42");
  expect(parsePostId("https://x.com/user123/status/456?s=20")).toBe("456");
  expect(parsePostId("https://twitter.com/a/statuses/789")).toBe("789");
  expect(parsePostId("https://x.com/user123")).toBeNull();
  expect(parsePostId("12ab")).toBeNull();
  expect(parsePostId("")).toBeNull();
});

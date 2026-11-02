import type { EngineUser } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { mentionAt, mentionMatches } from "./mentions";

const user = (handle: string, name: string, followers: number, youFollow = false) =>
  ({ userId: handle, handle, name, followers, youFollow }) as EngineUser;

it("finds the @handle being typed at the caret, and nothing inside an email or after a space", () => {
  expect(mentionAt("hi @th", 6)).toEqual({ start: 3, end: 6, query: "th" });
  expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  // The caret decides: the user went back into the first mention, whose rest a pick replaces.
  expect(mentionAt("(@theo and @guil", 4)).toEqual({ start: 1, end: 6, query: "th" });
  // A selection is replaced too, with the rest of the word after it.
  expect(mentionAt("hi @thXYeo there", 6, 8)).toEqual({ start: 3, end: 10, query: "th" });
  expect(mentionAt("mail me@theo", 12)).toBeNull();
  expect(mentionAt("@theo done", 10)).toBeNull();
});

it("matches handles before names, people the user follows first, then the bigger account", () => {
  const people = [
    user("tamsin", "Tam Lin", 90_000),
    user("t9ships", "Theo", 300_000),
    user("theo_b", "Theo B", 50, true),
    user("alice", "Tess Theo", 10),
    user("me", "Me", 1, true),
  ];
  const handles = (query: string) =>
    mentionMatches(people, query, (u) => u.youFollow, "me").map((u) => u.handle);
  expect(handles("th")).toEqual(["theo_b", "t9ships", "alice"]);
  expect(handles("T")).toEqual(["theo_b", "t9ships", "tamsin", "alice"]);
  // Just the @: the people the user follows lead, never the user themself.
  expect(handles("")).toEqual(["theo_b", "t9ships", "tamsin", "alice"]);
});

import type { TextStyle } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { hasStyle, plainEntities, shiftStyles, styledRuns, toggleStyle } from "./textStyles";

const bold = (start: number, end: number): TextStyle => ({ start, end, style: "Bold" });
const italic = (start: number, end: number): TextStyle => ({ start, end, style: "Italic" });

it("toggles a style on the selection as X's toolbar does: on unless all of it has it, joining runs", () => {
  const on = toggleStyle([bold(0, 2)], 2, 5, "Bold");
  expect(on).toEqual([bold(0, 5)]);
  // Part of it bold: the press makes all of it bold.
  expect(toggleStyle([bold(0, 2), italic(1, 4)], 1, 4, "Bold")).toEqual([bold(0, 4), italic(1, 4)]);
  // All of it bold: off, leaving the rest of the run either side.
  expect(toggleStyle(on, 1, 3, "Bold")).toEqual([bold(0, 1), bold(3, 5)]);
  expect(toggleStyle(on, 3, 3, "Bold")).toBe(on);
  // X's button is on for the character before the caret.
  expect([2, 5, 0].map((at) => hasStyle(on, at, at, "Bold"))).toEqual([true, true, false]);
});

it("moves runs with the text as typing in X's composer does", () => {
  // "ll" is bold; "l" typed before it is not, though the texts alone would read it as typed after.
  expect(shiftStyles([bold(1, 3)], "xll", "xlll", 2)).toEqual([bold(2, 4)]);
  // Typed at a run's end joins it; typed at its start does not.
  expect(shiftStyles([bold(0, 2)], "ab", "abc", 3)).toEqual([bold(0, 3)]);
  expect(shiftStyles([bold(0, 2)], "ab", "xab", 1)).toEqual([bold(1, 3)]);
  // What replaces a run's part takes its style; a replacement starting at its end does not.
  expect(shiftStyles([bold(0, 2)], "abcd", "aXd", 2)).toEqual([bold(0, 2)]);
  expect(shiftStyles([bold(0, 2)], "abcd", "abX", 3)).toEqual([bold(0, 2)]);
  // A whole bold word typed over stays bold.
  expect(shiftStyles([bold(3, 6)], "go big now", "go huge now", 7)).toEqual([bold(3, 7)]);
  // Deleted whole, it is gone.
  expect(shiftStyles([italic(1, 3)], "abcd", "ad", 1)).toEqual([]);
});

it("leaves mentions, hashtags, cashtags and links plain, as X's composer does", () => {
  const text = "see #ship and https://x.co/a, @alice $TSLA";
  expect(plainEntities(text, [bold(0, text.length)])).toEqual([
    bold(0, 4),
    bold(9, 14),
    bold(28, 30),
    bold(36, 37),
  ]);
});

it("cuts text where its runs start and end, counting from where it sits in the post", () => {
  expect(styledRuns("it today", 5, [bold(0, 7), italic(5, 13)])).toEqual([
    { start: 0, text: "it", bold: true, italic: true },
    { start: 2, text: " today", bold: false, italic: true },
  ]);
});

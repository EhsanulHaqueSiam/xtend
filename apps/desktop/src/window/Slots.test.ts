import { expect, it } from "vite-plus/test";

import { close, dismiss, slotBounds } from "./Slots.ts";

const win = { width: 1440, height: 920 };
const column = { x: 420, y: -300, width: 600, height: 4000 };

it("puts center and bar over X's column, or a centered 600px column without one", () => {
  expect(slotBounds({ kind: "center", route: "/plan" }, win, column)).toEqual({
    x: 420,
    y: 0,
    width: 600,
    height: 920,
  });
  expect(slotBounds({ kind: "bar", route: "/bar/find" }, win, column)).toEqual({
    x: 420,
    y: 0,
    width: 600,
    height: 44,
  });
  expect(slotBounds({ kind: "center", route: "/plan" }, win, null)).toEqual({
    x: 420,
    y: 0,
    width: 600,
    height: 920,
  });
  expect(slotBounds({ kind: "center", route: "/plan" }, { width: 500, height: 600 }, null)).toEqual(
    { x: 0, y: 0, width: 500, height: 600 },
  );
});

it("hangs a popover below its anchor, flips above when there is no room, and stays inside", () => {
  const anchor = { x: 700, y: 100, width: 60, height: 20 };
  expect(slotBounds({ kind: "popover", route: "/p", anchor }, win, null)).toEqual({
    x: 700,
    y: 128,
    width: 340,
    height: 320,
  });
  const low = { ...anchor, y: 800 };
  expect(slotBounds({ kind: "popover", route: "/p", anchor: low }, win, null)).toEqual({
    x: 700,
    y: 472,
    width: 340,
    height: 320,
  });
  const edge = { ...anchor, x: 1300 };
  expect(slotBounds({ kind: "popover", route: "/p", anchor: edge }, win, null).x).toBe(1100);
});

it("centers the palette, sheet and toast", () => {
  expect(slotBounds({ kind: "palette", route: "/palette" }, win, null)).toEqual({
    x: 400,
    y: 80,
    width: 640,
    height: 420,
  });
  expect(slotBounds({ kind: "sheet", route: "/s" }, win, null)).toEqual({
    x: 380,
    y: 440,
    width: 680,
    height: 480,
  });
  expect(slotBounds({ kind: "toast", route: "/t" }, win, null)).toEqual({
    x: 540,
    y: 832,
    width: 360,
    height: 64,
  });
});

it("dismisses everything but a toast, and a named close only closes its own kind", () => {
  const center = { kind: "center", route: "/plan" } as const;
  const toast = { kind: "toast", route: "/toast" } as const;
  expect(dismiss(center)).toBeNull();
  expect(dismiss(toast)).toBe(toast);
  expect(close(center, "palette")).toBe(center);
  expect(close(center, "center")).toBeNull();
  expect(close(center)).toBeNull();
  expect(close(null, "center")).toBeNull();
});

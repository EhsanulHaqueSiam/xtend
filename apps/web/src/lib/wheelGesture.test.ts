import { expect, it } from "vite-plus/test";

import { advance, type Gesture, IDLE, release, type WheelAction } from "./wheelGesture";

const ALL = { back: true, forward: true, refresh: true };

/** Feeds wheel deltas through one gesture; returns what fired early and what letting go does. */
const run = (
  steps: ReadonlyArray<readonly [number, number]>,
  { atTop = false, can = ALL }: { atTop?: boolean; can?: Record<WheelAction, boolean> } = {},
) => {
  let g: Gesture = IDLE;
  const fired: Array<WheelAction> = [];
  for (const [dx, dy] of steps) {
    const next = advance(g, { dx, dy, atTop, can });
    g = next.gesture;
    if (next.fire !== undefined) fired.push(next.fire);
  }
  return { fired, released: release(g) };
};

const swipe = (dx: number, n: number) => Array.from({ length: n }, () => [dx, 0] as const);

it("goes back on a sideways swipe past the arm point, and not before it", () => {
  expect(run(swipe(-20, 8))).toEqual({ fired: [], released: "back" });
  expect(run(swipe(20, 8))).toEqual({ fired: [], released: "forward" });
  expect(run(swipe(-20, 3)).released).toBeNull();
  // Swiping back the other way before letting go cancels.
  expect(run([...swipe(-20, 8), ...swipe(20, 5)]).released).toBeNull();
  // Nowhere to go back to.
  expect(run(swipe(-20, 8), { can: { ...ALL, back: false } }).released).toBeNull();
});

it("acts once when momentum coasts after the fingers lift", () => {
  const coasting = [-40, -36, -32, -28, -25, -22, -19, -17, -15, -13, -11].map(
    (dx) => [dx, 0] as const,
  );
  expect(run([...swipe(-20, 6), ...coasting])).toEqual({ fired: ["back"], released: null });
});

it("refreshes on a pull down only at the top, and never on a vertical scroll or a diagonal", () => {
  const pull = Array.from({ length: 8 }, () => [0, -15] as const);
  expect(run(pull, { atTop: true }).released).toBe("refresh");
  expect(run(pull, { atTop: false }).released).toBeNull();
  // Two big mouse-wheel notches past the top are not a pull.
  expect(
    run(
      [
        [0, -100],
        [0, -100],
      ],
      { atTop: true },
    ).released,
  ).toBeNull();
  expect(
    run(
      Array.from({ length: 8 }, () => [-12, -15] as const),
      { atTop: true },
    ).released,
  ).toBeNull();
});

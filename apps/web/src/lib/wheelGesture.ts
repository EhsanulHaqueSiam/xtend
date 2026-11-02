/**
 * A trackpad scroll read as a gesture: two fingers sideways go back or forward, two fingers down
 * at the top of a list refresh it. Chromium reports neither the fingers landing nor lifting, so a
 * gesture runs from its first wheel event to a pause (`WHEEL_PAUSE_MS`), and macOS momentum that
 * coasts after the lift counts as the release.
 */
export type WheelAction = "back" | "forward" | "refresh";

export type Gesture =
  | { readonly kind: "idle" }
  | { readonly kind: "undecided"; readonly dx: number; readonly dy: number }
  /** Ordinary scrolling, or a gesture already acted on: ignored until the pause. */
  | { readonly kind: "scroll" }
  | {
      readonly kind: "drag";
      readonly action: WheelAction;
      /** How far the fingers went the gesture's way, in wheel pixels; never below 0. */
      readonly distance: number;
      readonly last: number;
      /** Steps in a row that went the gesture's way without speeding up: momentum after the lift. */
      readonly coast: number;
      readonly steps: number;
    };

export interface WheelInput {
  readonly dx: number;
  readonly dy: number;
  /** The list sits at its top, so a pull down is not a scroll. */
  readonly atTop: boolean;
  readonly can: Readonly<Record<WheelAction, boolean>>;
}

export const IDLE: Gesture = { kind: "idle" };
export const WHEEL_PAUSE_MS = 140;
const DEAD_ZONE = 10;
const ARM: Record<WheelAction, number> = { back: 110, forward: 110, refresh: 80 };
const COAST_STEPS = 6;
const MIN_STEPS = 4;

/**
 * Whether letting go now would act. A mouse wheel moves in a few big notches, so a gesture arms
 * only after `MIN_STEPS` events: one more notch at the top of a list is not a pull.
 */
export const armed = (g: Gesture) =>
  g.kind === "drag" && g.steps >= MIN_STEPS && g.distance >= ARM[g.action];

/** How far along the gesture is, 0 to 1, for the indicator. */
export const progress = (g: Gesture) =>
  g.kind === "drag" ? Math.min(1, g.distance / ARM[g.action]) : 0;

const along = (action: WheelAction, dx: number, dy: number) =>
  action === "back" ? -dx : action === "forward" ? dx : -dy;

/** One wheel event; `fire` is set when momentum shows the fingers already let go past the arm point. */
export function advance(g: Gesture, input: WheelInput): { gesture: Gesture; fire?: WheelAction } {
  const { dx, dy } = input;
  if (g.kind === "scroll") return { gesture: g };
  if (g.kind === "idle" || g.kind === "undecided") {
    const sx = (g.kind === "undecided" ? g.dx : 0) + dx;
    const sy = (g.kind === "undecided" ? g.dy : 0) + dy;
    if (Math.abs(sx) + Math.abs(sy) < DEAD_ZONE)
      return { gesture: { kind: "undecided", dx: sx, dy: sy } };
    // Locked to one axis from here, so a diagonal flick through a list never navigates.
    const action: WheelAction | null =
      Math.abs(sx) > Math.abs(sy) * 1.5
        ? sx < 0
          ? "back"
          : "forward"
        : sy < 0 && input.atTop && Math.abs(sy) > Math.abs(sx) * 1.5
          ? "refresh"
          : null;
    if (action === null || !input.can[action]) return { gesture: { kind: "scroll" } };
    const step = along(action, sx, sy);
    return { gesture: { kind: "drag", action, distance: step, last: step, coast: 0, steps: 1 } };
  }
  const step = along(g.action, dx, dy);
  // macOS momentum decays 4% to 30% a step (T3 Code traced it); a hand slowing to reverse does not.
  const decay = g.last > 0 ? step / g.last : 0;
  const coast = step >= 4 && decay >= 0.7 && decay <= 0.96 ? g.coast + 1 : 0;
  const next: Gesture = {
    ...g,
    distance: Math.max(0, g.distance + step),
    last: step,
    coast,
    steps: g.steps + 1,
  };
  if (armed(next) && coast >= COAST_STEPS) return { gesture: { kind: "scroll" }, fire: g.action };
  return { gesture: next };
}

/** The pause that ends a gesture: what letting go does. */
export const release = (g: Gesture): WheelAction | null =>
  g.kind === "drag" && armed(g) ? g.action : null;

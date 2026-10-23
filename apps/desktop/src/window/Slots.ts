import type { Rect, SlotKind, SlotOpen } from "../ipc/channels.ts";

/**
 * Where the xtend view sits over x.com. Main owns the open slot; the app only
 * asks for "route R in slot S". Pure so the geometry and dismissal rules are
 * testable without Electron.
 */

export const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

interface Size {
  readonly width: number;
  readonly height: number;
}

const FALLBACK_COLUMN_WIDTH = 600;
const BAR_HEIGHT = 44;
const GAP = 8;
const PALETTE_TOP = 80;
const TOAST_MARGIN = 24;
const SIZE = {
  popover: { width: 340, height: 320 },
  sheet: { width: 680, height: 480 },
  palette: { width: 640, height: 420 },
  toast: { width: 360, height: 64 },
} satisfies Partial<Record<SlotKind, Size>>;

const clamp = (value: number, size: number, limit: number) =>
  Math.max(0, Math.min(value, limit - size));

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
});

/**
 * Pages that bring a companion column: the slot also covers X's right column, where the page
 * draws its preview and assist cards while X's trends sit underneath. Compose only does while
 * a draft is open; its list leaves X's right column alone.
 */
const COMPOSER = /[?&](draft|new|text|inspire|reply)=/;
export const isWide = (route: string) =>
  route.split(/[?#]/)[0] === "/compose" && COMPOSER.test(route);

/** A toast times itself out in the app; every other slot goes on pointer-down in x.com or Esc. */
export const dismiss = (current: SlotOpen | null): SlotOpen | null =>
  current?.kind === "toast" ? current : null;

/** The app's close request: a named kind only closes itself, so a stale close cannot hide a newer slot. */
export const close = (current: SlotOpen | null, kind?: SlotKind): SlotOpen | null =>
  kind === undefined || current?.kind === kind ? null : current;

/**
 * Bounds for an open slot, in window CSS pixels. `column` is X's primary
 * column when the page has one; otherwise a 600px column centered in the
 * window stands in, so DMs and settings pages still get a center slot.
 * `sidebar` is X's right column; wide routes stretch over it when X shows one.
 */
export function slotBounds(
  slot: SlotOpen,
  window: Size,
  column: Rect | null,
  sidebar: Rect | null = null,
): Rect {
  const columnWidth = Math.min(column?.width ?? FALLBACK_COLUMN_WIDTH, window.width);
  const columnX = column?.x ?? (window.width - columnWidth) / 2;
  switch (slot.kind) {
    case "center": {
      const right =
        sidebar !== null && column !== null && isWide(slot.route)
          ? Math.min(sidebar.x + sidebar.width, window.width)
          : columnX + columnWidth;
      return rect(columnX, 0, right - columnX, window.height);
    }
    case "bar":
      return rect(columnX, 0, columnWidth, BAR_HEIGHT);
    case "palette":
      return rect(
        (window.width - SIZE.palette.width) / 2,
        PALETTE_TOP,
        SIZE.palette.width,
        SIZE.palette.height,
      );
    case "sheet":
      return rect(
        (window.width - SIZE.sheet.width) / 2,
        window.height - SIZE.sheet.height,
        SIZE.sheet.width,
        SIZE.sheet.height,
      );
    case "toast":
      return rect(
        (window.width - SIZE.toast.width) / 2,
        window.height - SIZE.toast.height - TOAST_MARGIN,
        SIZE.toast.width,
        SIZE.toast.height,
      );
    case "popover": {
      const { width, height } = SIZE.popover;
      const anchor = slot.anchor ?? {
        x: (window.width - width) / 2,
        y: (window.height - height) / 2 - GAP,
        width: 0,
        height: 0,
      };
      const below = anchor.y + anchor.height + GAP;
      const y = below + height <= window.height ? below : anchor.y - GAP - height;
      return rect(
        clamp(anchor.x, width, window.width),
        clamp(y, height, window.height),
        width,
        height,
      );
    }
  }
}

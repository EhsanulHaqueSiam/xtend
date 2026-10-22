import type { Slot } from "@xtend/contracts";

export { hhmm } from "../../lib/time";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const slotsOn = (slots: ReadonlyArray<Slot>, weekday: number) =>
  slots.filter((s) => (s.weekdayMask & (1 << weekday)) !== 0);

import type { Draft, Slot } from "@xtend/contracts";

import { postCostUsd } from "../compose/ThreadEditor";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const hhmm = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;

export const localMinute = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Local "YYYY-MM-DD"; the key the calendar atom and the week grid share. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday 00:00 of the week containing `d`, matching the spec's Mon..Sun grid. */
export const weekStart = (d: Date) => {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

export const slotsOn = (slots: ReadonlyArray<Slot>, weekday: number) =>
  slots.filter((s) => (s.weekdayMask & (1 << weekday)) !== 0);

export const draftCostUsd = (d: Draft) => d.blocks.reduce((sum, b) => sum + postCostUsd(b.text), 0);
export const usd = (n: number) => `$${n.toFixed(3)}`;

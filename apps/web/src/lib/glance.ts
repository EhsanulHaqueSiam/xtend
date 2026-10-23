import type { Draft, Slot } from "@xtend/contracts";

import type { Glance } from "../desktopBridge";
import { hhmm, partsIn } from "./time";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "21:40", "Tomorrow 21:40" or "Thu 21:40" for a wall time `days` ahead in the account zone. */
const dayLabel = (days: number, weekday: number, minute: number) =>
  days === 0
    ? hhmm(minute)
    : days === 1
      ? `Tomorrow ${hhmm(minute)}`
      : `${WEEKDAYS[weekday]} ${hhmm(minute)}`;

/** The next posting slot after `now`, as a label; null without slots. */
export function nextSlotLabel(slots: ReadonlyArray<Slot>, zone: string, now: Date): string | null {
  const today = partsIn(zone, now);
  const nowMinute = today.hour * 60 + today.minute;
  for (let days = 0; days < 8; days++) {
    const weekday = (today.weekday + days) % 7;
    const minutes = slots
      .filter(
        (s) => (s.weekdayMask & (1 << weekday)) !== 0 && (days > 0 || s.minuteOfDay > nowMinute),
      )
      .map((s) => s.minuteOfDay);
    if (minutes.length > 0) return dayLabel(days, weekday, Math.min(...minutes));
  }
  return null;
}

/** The earliest queued draft's time as a label; null with nothing scheduled. */
export function nextScheduledLabel(
  queued: ReadonlyArray<Draft>,
  zone: string,
  now: Date,
): string | null {
  const times = queued.flatMap((d) => (d.scheduledAt === null ? [] : [Date.parse(d.scheduledAt)]));
  if (times.length === 0) return null;
  const at = new Date(Math.min(...times));
  const p = partsIn(zone, at);
  const days = Math.round(
    (Date.UTC(p.year, p.month - 1, p.day) -
      Date.UTC(partsIn(zone, now).year, partsIn(zone, now).month - 1, partsIn(zone, now).day)) /
      86_400_000,
  );
  return dayLabel(Math.max(0, days), p.weekday, p.hour * 60 + p.minute);
}

export function glanceOf(input: {
  readonly queued: ReadonlyArray<Draft>;
  readonly slots: ReadonlyArray<Slot>;
  readonly openMentions: number;
  readonly spendTodayUsd: number;
  readonly connected: boolean;
  readonly zone: string;
  readonly now: Date;
}): Glance {
  return {
    queued: input.queued.length,
    nextScheduled: nextScheduledLabel(input.queued, input.zone, input.now),
    bestTime: nextSlotLabel(input.slots, input.zone, input.now),
    mentions: input.openMentions,
    spendTodayUsd: input.spendTodayUsd,
    connected: input.connected,
  };
}

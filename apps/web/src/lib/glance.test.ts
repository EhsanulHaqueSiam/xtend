import type { Draft } from "@xtend/contracts";
import { expect, it } from "vite-plus/test";

import { nextScheduledLabel, nextSlotLabel } from "./glance";

// Friday 23 Oct 2026, 15:00 in Dhaka (UTC+6).
const now = new Date("2026-10-23T09:00:00Z");
const zone = "Asia/Dhaka";
const FRI = 1 << 5;
const SAT = 1 << 6;
const SUN = 1 << 0;

it("picks the next slot after now, rolling to tomorrow and later weekdays", () => {
  expect(nextSlotLabel([{ id: 1, weekdayMask: FRI, minuteOfDay: 9 * 60 }], zone, now)).toBe(
    "Fri 09:00",
  );
  expect(
    nextSlotLabel(
      [
        { id: 1, weekdayMask: FRI, minuteOfDay: 21 * 60 + 40 },
        { id: 2, weekdayMask: FRI, minuteOfDay: 18 * 60 },
      ],
      zone,
      now,
    ),
  ).toBe("18:00");
  expect(nextSlotLabel([{ id: 1, weekdayMask: SAT, minuteOfDay: 9 * 60 }], zone, now)).toBe(
    "Tomorrow 09:00",
  );
  expect(nextSlotLabel([{ id: 1, weekdayMask: SUN, minuteOfDay: 9 * 60 }], zone, now)).toBe(
    "Sun 09:00",
  );
  expect(nextSlotLabel([], zone, now)).toBeNull();
});

it("labels the earliest queued draft in the account zone", () => {
  const draft = (scheduledAt: string | null) => ({ scheduledAt }) as Draft;
  expect(nextScheduledLabel([draft(null)], zone, now)).toBeNull();
  expect(
    nextScheduledLabel([draft("2026-10-24T03:30:00Z"), draft("2026-10-23T12:00:00Z")], zone, now),
  ).toBe("18:00");
  expect(nextScheduledLabel([draft("2026-10-24T03:30:00Z")], zone, now)).toBe("Tomorrow 09:30");
});

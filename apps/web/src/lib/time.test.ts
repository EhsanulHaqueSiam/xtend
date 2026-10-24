import { expect, it } from "vite-plus/test";

import { dayStartIn, localInputToInstant, weekStartIn } from "./time";

const at = (zone: string, value: string) => localInputToInstant(zone, value)?.toISOString();

it("reads a picked wall time in the account zone, whatever the browser's", () => {
  expect(at("Asia/Dhaka", "2026-10-24T09:00")).toBe("2026-10-24T03:00:00.000Z");
  expect(at("America/Los_Angeles", "2026-10-24T09:00")).toBe("2026-10-24T16:00:00.000Z");
  expect(at("Asia/Dhaka", "not a time")).toBeUndefined();
});

it("places times on a DST change day on the right side of the change", () => {
  // New York springs forward at 02:00 on 8 Mar 2026: 01:30 is EST, 03:30 already EDT.
  expect(at("America/New_York", "2026-03-08T01:30")).toBe("2026-03-08T06:30:00.000Z");
  expect(at("America/New_York", "2026-03-08T03:30")).toBe("2026-03-08T07:30:00.000Z");
  // Berlin springs forward at 02:00 on 29 Mar 2026: 01:30 is still CET.
  expect(at("Europe/Berlin", "2026-03-29T01:30")).toBe("2026-03-29T00:30:00.000Z");
  // New York falls back on 1 Nov 2026: the evening is EST again.
  expect(at("America/New_York", "2026-11-01T21:00")).toBe("2026-11-02T02:00:00.000Z");
});

it("lays a week over a DST change from Monday midnight in the zone", () => {
  const zone = "Europe/Berlin";
  const monday = weekStartIn(zone, new Date("2026-03-26T12:00:00Z"));
  expect(monday.toISOString()).toBe("2026-03-22T23:00:00.000Z");
  // The next Monday starts at midnight CEST, an hour sooner than 7 x 24 hours on.
  expect(dayStartIn(zone, monday, 7).toISOString()).toBe("2026-03-29T22:00:00.000Z");
});

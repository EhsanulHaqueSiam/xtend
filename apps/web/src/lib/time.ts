/**
 * Calendar arithmetic in the account's zone (Settings.timeZone), never the
 * browser's: a slot at 09:00 Dhaka is 09:00 wherever the UI is opened.
 */
export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  /** 0 = Sunday. */
  readonly weekday: number;
  readonly hour: number;
  readonly minute: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatter = (zone: string) => {
  let f = formatters.get(zone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
};

export const partsIn = (zone: string, d: Date): ZonedParts => {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(zone).formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAYS.indexOf(p.weekday ?? "Sun"),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
};

/** "YYYY-MM-DD" of the instant in the zone. */
export const dayKeyIn = (zone: string, d: Date) => {
  const p = partsIn(zone, d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

export const minuteIn = (zone: string, d: Date) => {
  const p = partsIn(zone, d);
  return p.hour * 60 + p.minute;
};

/** The instant at which the zone's clock shows this wall time. One offset correction; DST gaps round. */
const instantIn = (zone: string, year: number, month: number, day: number, minute = 0) => {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60);
  const p = partsIn(zone, new Date(guess));
  const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (seen - guess));
};

/** A `datetime-local` value ("YYYY-MM-DDTHH:MM") read as wall time in the zone. */
export const localInputToInstant = (zone: string, value: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (m === null) return null;
  return instantIn(
    zone,
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]) * 60 + Number(m[5]),
  );
};

/** Midnight of the instant's day in the zone, moved by `days`. */
export const dayStartIn = (zone: string, d: Date, days = 0) => {
  const p = partsIn(zone, d);
  return instantIn(zone, p.year, p.month, p.day + days);
};

/** Monday 00:00 in the zone of the week containing `d`. */
export const weekStartIn = (zone: string, d: Date) =>
  dayStartIn(zone, d, -((partsIn(zone, d).weekday + 6) % 7));

export const hhmm = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;

// Timestamps rendered outside the calendar (drafts, mentions, runs) read the zone from here;
// the root route sets it once Settings loads.
let displayZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let whenFormat = makeWhen(displayZone);
function makeWhen(zone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export const setDisplayZone = (zone: string) => {
  if (zone === displayZone) return;
  displayZone = zone;
  whenFormat = makeWhen(zone);
};
export const fmtWhen = (iso: string) => whenFormat.format(new Date(iso));

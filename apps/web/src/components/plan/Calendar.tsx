import type { Draft, Slot } from "@xtend/contracts";

import { dayKeyIn, dayStartIn, hhmm, minuteIn, partsIn } from "../../lib/time";
import { cn } from "../../lib/utils";
import { draftTitle } from "../compose/DraftsList";
import { inputClass } from "../compose/ThreadEditor";
import { DAYS, slotsOn } from "./ui";

interface Event {
  readonly minute: number;
  readonly draft: Draft | null;
}

const draftAt = (d: Draft) => new Date(d.postedAt ?? d.scheduledAt ?? "");

/** Slot times and drafts for one day in the zone, merged so a draft sitting on its slot fills that cell. */
const dayEvents = (
  zone: string,
  dayStart: Date,
  slots: ReadonlyArray<Slot>,
  drafts: ReadonlyArray<Draft>,
): Array<Event> => {
  const key = dayKeyIn(zone, dayStart);
  const events: Array<Event> = drafts
    .filter((d) => dayKeyIn(zone, draftAt(d)) === key)
    .map((d) => ({ minute: minuteIn(zone, draftAt(d)), draft: d }));
  for (const s of slotsOn(slots, partsIn(zone, dayStart).weekday))
    if (!events.some((e) => e.minute === s.minuteOfDay))
      events.push({ minute: s.minuteOfDay, draft: null });
  return events.sort((a, b) => a.minute - b.minute);
};

/** Empty slots still ahead of `now` in the week; the header's consistency nudge. */
export const emptySlotCount = (
  zone: string,
  start: Date,
  now: Date,
  slots: ReadonlyArray<Slot>,
  drafts: ReadonlyArray<Draft>,
) =>
  Array.from({ length: 7 }, (_, i) => {
    const day = dayStartIn(zone, start, i);
    return dayEvents(zone, day, slots, drafts).filter(
      (e) => e.draft === null && day.getTime() + e.minute * 60_000 > now.getTime(),
    ).length;
  }).reduce((a, b) => a + b, 0);

export function Calendar({
  zone,
  start,
  now,
  slots,
  drafts,
  fillable,
  onFill,
  onOpen,
}: {
  readonly zone: string;
  /** Monday 00:00 in the zone. */
  readonly start: Date;
  readonly now: Date;
  readonly slots: ReadonlyArray<Slot>;
  readonly drafts: ReadonlyArray<Draft>;
  /** Drafts a user can drop into an empty slot. */
  readonly fillable: ReadonlyArray<Draft>;
  readonly onFill: (id: string, at: Date) => void;
  readonly onOpen: (d: Draft) => void;
}) {
  const today = dayKeyIn(zone, now);
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
      {Array.from({ length: 7 }, (_, i) => {
        const day = dayStartIn(zone, start, i);
        const key = dayKeyIn(zone, day);
        const parts = partsIn(zone, day);
        const past = key !== today && day < now;
        return (
          <div key={i} className="flex min-h-40 flex-col gap-1 bg-card p-1.5">
            <span
              className={cn(
                "font-mono text-2xs text-muted-foreground",
                key === today && "text-foreground",
              )}
            >
              {DAYS[parts.weekday]} {parts.day}
            </span>
            {dayEvents(zone, day, slots, drafts).map((e) => {
              const d = e.draft;
              return d === null ? (
                past ? null : (
                  <select
                    key={e.minute}
                    aria-label={`Empty slot ${hhmm(e.minute)}`}
                    className={cn(
                      inputClass,
                      "rounded-sm border-dashed px-1 py-0.5 text-2xs text-muted-foreground",
                    )}
                    value=""
                    onChange={(ev) =>
                      onFill(ev.target.value, new Date(day.getTime() + e.minute * 60_000))
                    }
                  >
                    <option value="">{hhmm(e.minute)} empty slot</option>
                    {fillable.map((d) => (
                      <option key={d.id} value={d.id}>
                        {draftTitle(d)}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <button
                  key={d.id}
                  className={cn(
                    "truncate rounded-sm border px-1 py-0.5 text-left font-mono text-2xs",
                    d.status === "posted" && "border-success/40 text-success-foreground",
                    (d.status === "queued" || d.status === "posting") &&
                      "border-info/40 text-info-foreground",
                    d.status === "failed" && "border-error/40 text-error-foreground",
                  )}
                  title={draftTitle(d)}
                  onClick={() => onOpen(d)}
                >
                  {hhmm(e.minute)}{" "}
                  {d.status === "posted"
                    ? `✓ ${d.postIds.length} posted`
                    : d.status === "failed"
                      ? `✕ ${draftTitle(d)}`
                      : draftTitle(d)}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

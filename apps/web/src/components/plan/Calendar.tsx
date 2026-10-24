import type { Draft, Slot } from "@xtend/contracts";

import { dayKeyIn, dayStartIn, hhmm, localInputToInstant, minuteIn, partsIn } from "../../lib/time";
import { cn } from "../../lib/utils";
import { draftTitle } from "../compose/DraftsList";
import { Menu, MenuItem } from "../ui/menu";
import { DAYS, slotsOn, StatusDot } from "./ui";

interface Event {
  readonly minute: number;
  readonly draft: Draft | null;
}

const draftAt = (d: Draft) => new Date(d.postedAt ?? d.scheduledAt ?? "");

/** When the zone's clock shows `minute` on that day; midnight plus minutes is an hour off on DST days. */
const slotAt = (zone: string, dayKey: string, minute: number) =>
  localInputToInstant(zone, `${dayKey}T${hhmm(minute)}`)!;

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
    const key = dayKeyIn(zone, day);
    return dayEvents(zone, day, slots, drafts).filter(
      (e) => e.draft === null && slotAt(zone, key, e.minute) > now,
    ).length;
  }).reduce((a, b) => a + b, 0);

/**
 * The week as seven full-height columns. Each day lists its posts and open slots by time; an
 * open slot ahead of now takes a draft from its menu.
 */
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
    <div className="grid min-h-full grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => {
        const day = dayStartIn(zone, start, i);
        const key = dayKeyIn(zone, day);
        const parts = partsIn(zone, day);
        const isToday = key === today;
        const past = !isToday && day < now;
        return (
          <section
            key={key}
            aria-label={`${DAYS[parts.weekday]} ${parts.day}`}
            className={cn(
              "flex min-w-0 flex-col border-r border-border last:border-r-0",
              isToday && "bg-white/[0.02]",
            )}
          >
            <h2
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-3 font-mono text-2xs tabular-nums",
                isToday ? "text-foreground" : "text-muted-foreground",
                past && "opacity-60",
              )}
            >
              {DAYS[parts.weekday]} {parts.day}
              {isToday ? <span className="size-1 rounded-full bg-foreground" /> : null}
            </h2>
            <div className="flex flex-col gap-1 p-1.5">
              {dayEvents(zone, day, slots, drafts).map((e) => {
                const d = e.draft;
                const at = slotAt(zone, key, e.minute);
                if (d !== null)
                  return (
                    <button
                      key={d.id}
                      type="button"
                      title={draftTitle(d)}
                      className="flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-white/[0.05]"
                      onClick={() => onOpen(d)}
                    >
                      <span className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground tabular-nums">
                        <StatusDot status={d.status} />
                        {hhmm(e.minute)}
                        {d.status === "queued" ? null : <span>{d.status}</span>}
                      </span>
                      <span className="line-clamp-2 text-xs leading-snug break-words">
                        {draftTitle(d)}
                      </span>
                    </button>
                  );
                // A slot already gone, today's included, would be posted by the scheduler's next tick.
                if (at <= now) return null;
                return (
                  <Menu
                    key={e.minute}
                    label={`Fill ${hhmm(e.minute)}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Empty slot ${hhmm(e.minute)}`}
                        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-white/13 px-1.5 py-1 text-left font-mono text-2xs text-muted-foreground tabular-nums transition-colors duration-150 hover:border-white/25 hover:text-foreground data-popup-open:border-white/25 data-popup-open:text-foreground"
                      >
                        {hhmm(e.minute)}
                        <span className="font-sans">open</span>
                      </button>
                    }
                  >
                    {fillable.length === 0 ? (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        No drafts to place
                      </p>
                    ) : (
                      fillable.map((f) => (
                        <MenuItem key={f.id} onClick={() => onFill(f.id, at)}>
                          <span className="min-w-0 flex-1 truncate">{draftTitle(f)}</span>
                          <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                            {f.kind === "article" ? "article" : f.blocks.length}
                          </span>
                        </MenuItem>
                      ))
                    )}
                  </Menu>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import type { Draft, Heatmap, Slot } from "@xtend/contracts";
import { useState, type DragEvent } from "react";

import { DRAFT_TYPE } from "../../lib/drag";
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

/** Drop handlers for a time that takes a dragged draft; `data-over` marks it while one hovers. */
const takesDraft = (onDrop: (id: string) => void) => ({
  onDragOver: (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAFT_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    event.currentTarget.setAttribute("data-over", "");
  },
  onDragLeave: (event: DragEvent) => event.currentTarget.removeAttribute("data-over"),
  onDrop: (event: DragEvent) => {
    event.preventDefault();
    event.currentTarget.removeAttribute("data-over");
    const id = event.dataTransfer.getData(DRAFT_TYPE);
    if (id !== "") onDrop(id);
  },
});

/** The drafts a time can take, as menu items. */
function FillItems({
  fillable,
  onPick,
}: {
  readonly fillable: ReadonlyArray<Draft>;
  readonly onPick: (id: string) => void;
}) {
  return fillable.length === 0 ? (
    <p className="px-2 py-1.5 text-xs text-muted-foreground">No drafts to place</p>
  ) : (
    fillable.map((f) => (
      <MenuItem key={f.id} onClick={() => onPick(f.id)}>
        <span className="min-w-0 flex-1 truncate">{draftTitle(f)}</span>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">
          {f.kind === "article" ? "article" : f.blocks.length}
        </span>
      </MenuItem>
    ))
  );
}

/**
 * One day's 24 hours as the best-time histogram. Each hour ahead of now takes a dropped
 * draft or offers one from its menu, so a post can land at a time that is not a slot.
 */
function DayRuler({
  zone,
  day,
  now,
  heatmap,
  fillable,
  onFill,
}: {
  readonly zone: string;
  readonly day: Date;
  readonly now: Date;
  readonly heatmap: Heatmap | null;
  readonly fillable: ReadonlyArray<Draft>;
  readonly onFill: (id: string, at: Date) => void;
}) {
  const key = dayKeyIn(zone, day);
  const { weekday, day: dayNum } = partsIn(zone, day);
  const hours = Array.from({ length: 24 }, (_, h) => heatmap?.cells[weekday * 24 + h] ?? 0);
  const max = Math.max(1, ...hours);
  const best = new Set(
    (heatmap?.best ?? []).filter((b) => b.weekday === weekday).map((b) => b.hour),
  );
  return (
    <section aria-label="Day ruler" className="shrink-0 border-t border-border px-6 pt-3 pb-2">
      <p className="flex items-baseline gap-2 font-mono text-2xs text-muted-foreground tabular-nums">
        <span className="text-foreground">
          {DAYS[weekday]} {dayNum}
        </span>
        <span>drop a draft on an hour</span>
        <span className="ml-auto">
          {heatmap === null || heatmap.posts === 0
            ? "no observed posts yet"
            : `from ${heatmap.posts} observed posts`}
        </span>
      </p>
      <div className="mt-2 flex h-9 items-end gap-px">
        {hours.map((v, h) => {
          const at = slotAt(zone, key, h * 60);
          const past = at <= now;
          const label = `${hhmm(h * 60)} ${DAYS[weekday]} ${dayNum}`;
          const bar = (
            <span
              className={cn(
                "w-full rounded-[1px] transition-colors duration-150",
                best.has(h) ? "bg-foreground" : "bg-white/20 group-hover:bg-white/40",
              )}
              style={{ height: `${Math.max(10, (v / max) * 100)}%` }}
            />
          );
          if (past)
            return (
              <span key={h} aria-label={label} className="flex h-full flex-1 items-end opacity-40">
                {bar}
              </span>
            );
          return (
            <Menu
              key={h}
              label={`Fill ${hhmm(h * 60)}`}
              trigger={
                <button
                  type="button"
                  aria-label={label}
                  className="group flex h-full flex-1 cursor-pointer items-end rounded-sm transition-colors duration-150 hover:bg-white/[0.05] data-over:bg-white/[0.12] data-popup-open:bg-white/[0.08]"
                  {...takesDraft((id) => onFill(id, at))}
                >
                  {bar}
                </button>
              }
            >
              <FillItems fillable={fillable} onPick={(id) => onFill(id, at)} />
            </Menu>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-2xs text-muted-foreground tabular-nums">
        {["00", "06", "12", "18", "24"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </section>
  );
}

/**
 * The week as seven full-height columns. Each day lists its posts and open slots by time; an
 * open slot ahead of now takes a draft from its menu or by drop, and a queued post drags to
 * another slot. Under the grid, the day ruler for the open day.
 */
export function Calendar({
  zone,
  start,
  now,
  slots,
  drafts,
  heatmap,
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
  readonly heatmap: Heatmap | null;
  /** Drafts a user can drop into an empty slot. */
  readonly fillable: ReadonlyArray<Draft>;
  readonly onFill: (id: string, at: Date) => void;
  readonly onOpen: (d: Draft) => void;
}) {
  const today = dayKeyIn(zone, now);
  const days = Array.from({ length: 7 }, (_, i) => dayStartIn(zone, start, i));
  // The ruler shows today when the week has it, else the week's first day.
  const [rulerKey, setRulerKey] = useState<string | null>(null);
  const rulerDay =
    days.find((d) => dayKeyIn(zone, d) === rulerKey) ??
    days.find((d) => dayKeyIn(zone, d) === today) ??
    days[0]!;
  return (
    <div className="flex min-h-full flex-col">
      <div className="grid flex-1 grid-cols-7">
        {days.map((day) => {
          const key = dayKeyIn(zone, day);
          const parts = partsIn(zone, day);
          const isToday = key === today;
          const past = !isToday && day < now;
          const onRuler = day === rulerDay;
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
                  "flex h-9 shrink-0 items-center border-b border-border font-mono text-2xs tabular-nums",
                  isToday ? "text-foreground" : "text-muted-foreground",
                  past && "opacity-60",
                )}
              >
                <button
                  type="button"
                  aria-pressed={onRuler}
                  title="Show this day on the ruler"
                  className="flex h-full w-full cursor-pointer items-center gap-1.5 px-3 text-left hover:text-foreground aria-pressed:text-foreground"
                  onClick={() => setRulerKey(key)}
                >
                  {DAYS[parts.weekday]} {parts.day}
                  {isToday ? <span className="size-1 rounded-full bg-foreground" /> : null}
                  {onRuler ? <span className="ml-auto h-px w-3 bg-foreground" aria-hidden /> : null}
                </button>
              </h2>
              <div className="flex flex-col gap-1 p-1.5">
                {dayEvents(zone, day, slots, drafts).map((e) => {
                  const d = e.draft;
                  const at = slotAt(zone, key, e.minute);
                  if (d !== null) {
                    const movable = d.status === "queued";
                    return (
                      <button
                        key={d.id}
                        type="button"
                        title={draftTitle(d)}
                        draggable={movable}
                        className={cn(
                          "flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-white/[0.05]",
                          movable && "cursor-grab active:cursor-grabbing",
                        )}
                        onClick={() => onOpen(d)}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(DRAFT_TYPE, d.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
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
                  }
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
                          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-white/13 px-1.5 py-1 text-left font-mono text-2xs text-muted-foreground tabular-nums transition-colors duration-150 hover:border-white/25 hover:text-foreground data-over:border-white/60 data-over:text-foreground data-popup-open:border-white/25 data-popup-open:text-foreground"
                          {...takesDraft((id) => onFill(id, at))}
                        >
                          {hhmm(e.minute)}
                          <span className="font-sans">open</span>
                        </button>
                      }
                    >
                      <FillItems fillable={fillable} onPick={(id) => onFill(id, at)} />
                    </Menu>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <DayRuler
        zone={zone}
        day={rulerDay}
        now={now}
        heatmap={heatmap}
        fillable={fillable}
        onFill={onFill}
      />
    </div>
  );
}

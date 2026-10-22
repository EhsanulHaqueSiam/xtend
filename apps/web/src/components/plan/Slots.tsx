import type { Heatmap, Slot, SlotInput } from "@xtend/contracts";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Section } from "../analyze/ui";
import { inputClass } from "../compose/ThreadEditor";
import { Button } from "../ui/button";
import { DAYS, hhmm } from "./ui";

const toInput = ({ weekdayMask, minuteOfDay }: Slot): SlotInput => ({ weekdayMask, minuteOfDay });
// Unsaved rows have no id yet, so each edit row carries its own key.
type Row = SlotInput & { readonly key: number };
let nextKey = 0;
const toRow = (s: SlotInput): Row => ({ ...s, key: nextKey++ });
const strip = ({ weekdayMask, minuteOfDay }: Row): SlotInput => ({ weekdayMask, minuteOfDay });

/** Slot editor plus best hours from the view-weighted heatmap, each one click away from a slot. */
export function Slots({
  slots,
  heatmap,
  onSave,
}: {
  readonly slots: ReadonlyArray<Slot>;
  readonly heatmap: Heatmap | null;
  readonly onSave: (slots: ReadonlyArray<SlotInput>) => void;
}) {
  const [edit, setEdit] = useState<ReadonlyArray<Row>>(() => slots.map(toInput).map(toRow));
  const dirty = JSON.stringify(edit.map(strip)) !== JSON.stringify(slots.map(toInput));
  const set = (i: number, patch: Partial<SlotInput>) =>
    setEdit(edit.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = (slot: SlotInput) =>
    setEdit([...edit, toRow(slot)].sort((a, b) => a.minuteOfDay - b.minuteOfDay));

  return (
    <div className="flex flex-col gap-3">
      <Section
        title="Posting slots"
        actions={
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => add({ weekdayMask: 62, minuteOfDay: 540 })}
            >
              Add slot
            </Button>
            <Button
              size="xs"
              disabled={!dirty || edit.some((s) => s.weekdayMask === 0)}
              onClick={() => onSave(edit.map(strip))}
            >
              Save
            </Button>
          </div>
        }
      >
        {edit.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            No slots. The queue needs at least one to place drafts.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {edit.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <input
                  type="time"
                  className={inputClass + " w-auto"}
                  value={hhmm(s.minuteOfDay)}
                  onChange={(e) => {
                    const [h = 0, m = 0] = e.target.value.split(":").map(Number);
                    set(i, { minuteOfDay: h * 60 + m });
                  }}
                />
                {DAYS.map((day, weekday) => (
                  <label key={day} className="flex items-center gap-1 font-mono text-2xs">
                    <input
                      type="checkbox"
                      checked={(s.weekdayMask & (1 << weekday)) !== 0}
                      onChange={(e) =>
                        set(i, {
                          weekdayMask: e.target.checked
                            ? s.weekdayMask | (1 << weekday)
                            : s.weekdayMask & ~(1 << weekday),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
                <Button
                  variant="ghost-destructive"
                  size="icon-xs"
                  aria-label="Remove slot"
                  onClick={() => setEdit(edit.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Best hours">
        {heatmap === null || heatmap.best.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            Needs 10 observed posts with views. Refresh Analyze to collect them
            {heatmap === null ? "" : ` (${heatmap.posts} so far)`}.
          </p>
        ) : (
          <>
            <p className="pb-1 text-2xs text-muted-foreground">
              Hours where your {heatmap.posts} observed posts drew the most views.
            </p>
            <ol className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
              {heatmap.best.slice(0, 5).map((b) => (
                <li key={`${b.weekday}-${b.hour}`} className="flex items-center gap-2">
                  {DAYS[b.weekday]} {hhmm(b.hour * 60)}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => add({ weekdayMask: 1 << b.weekday, minuteOfDay: b.hour * 60 })}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ol>
          </>
        )}
      </Section>
    </div>
  );
}

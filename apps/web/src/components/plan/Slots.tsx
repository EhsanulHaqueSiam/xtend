import type { Heatmap, Slot, SlotInput } from "@xtend/contracts";
import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { fieldClass } from "../compose/ThreadEditor";
import { Companion } from "../shell/Companion";
import { Button } from "../ui/button";
import { table } from "../ui/layout";
import { XCard } from "../x";
import { DAYS, hhmm } from "./ui";

const toInput = ({ weekdayMask, minuteOfDay }: Slot): SlotInput => ({ weekdayMask, minuteOfDay });
// Unsaved rows have no id yet, so each edit row carries its own key.
type Row = SlotInput & { readonly key: number };
let nextKey = 0;
const toRow = (s: SlotInput): Row => ({ ...s, key: nextKey++ });
const strip = ({ weekdayMask, minuteOfDay }: Row): SlotInput => ({ weekdayMask, minuteOfDay });

/** Hours where the account's observed posts drew the most views, each one click from a slot. */
function BestHours({
  heatmap,
  empty,
  onAdd,
}: {
  readonly heatmap: Heatmap | null;
  /** The action that collects more posts, under the one line saying so. */
  readonly empty: ReactNode;
  readonly onAdd: (slot: SlotInput) => void;
}) {
  return (
    <XCard title="Best hours">
      {heatmap === null || heatmap.best.length === 0 ? (
        <div className="flex flex-col items-start gap-2.5">
          <p className="text-xs text-muted-foreground">
            Needs 10 of your posts with views
            {heatmap === null ? "" : `, ${heatmap.posts} so far`}.
          </p>
          {empty}
        </div>
      ) : (
        <>
          <ol className="flex flex-col">
            {heatmap.best.slice(0, 5).map((b) => (
              <li
                key={`${b.weekday}-${b.hour}`}
                className="flex items-center justify-between border-b border-border py-1 font-mono text-xs tabular-nums last:border-b-0"
              >
                {DAYS[b.weekday]} {hhmm(b.hour * 60)}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onAdd({ weekdayMask: 1 << b.weekday, minuteOfDay: b.hour * 60 })}
                >
                  Add slot
                </Button>
              </li>
            ))}
          </ol>
          <p className="pt-2 font-mono text-2xs text-muted-foreground">
            from {heatmap.posts} observed posts
          </p>
        </>
      )}
    </XCard>
  );
}

/** The posting slots as a table: a time and its weekdays per row, saved together. */
export function Slots({
  slots,
  heatmap,
  bestHoursEmpty,
  onSave,
}: {
  readonly slots: ReadonlyArray<Slot>;
  readonly heatmap: Heatmap | null;
  readonly bestHoursEmpty: ReactNode;
  readonly onSave: (slots: ReadonlyArray<SlotInput>) => void;
}) {
  const [edit, setEdit] = useState<ReadonlyArray<Row>>(() => slots.map(toInput).map(toRow));
  const dirty = JSON.stringify(edit.map(strip)) !== JSON.stringify(slots.map(toInput));
  const dayless = edit.some((s) => s.weekdayMask === 0);
  const set = (i: number, patch: Partial<SlotInput>) =>
    setEdit(edit.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = (slot: SlotInput) =>
    setEdit([...edit, toRow(slot)].sort((a, b) => a.minuteOfDay - b.minuteOfDay));

  return (
    <>
      <table className={table.root}>
        <thead>
          <tr>
            <th className={table.th}>Time</th>
            <th className={cn(table.th, "w-full")}>Days</th>
            <th className={table.th} />
          </tr>
        </thead>
        <tbody>
          {edit.map((s, i) => (
            <tr key={s.key} className={table.row}>
              <td className={cn(table.td, "py-1.5")}>
                <input
                  type="time"
                  aria-label="Slot time"
                  className={cn(
                    fieldClass,
                    "h-7 w-auto py-0 font-mono text-xs tabular-nums [color-scheme:dark]",
                  )}
                  value={hhmm(s.minuteOfDay)}
                  onChange={(e) => {
                    const [h = 0, m = 0] = e.target.value.split(":").map(Number);
                    set(i, { minuteOfDay: h * 60 + m });
                  }}
                />
              </td>
              <td className={table.td}>
                <div className="flex gap-0.5">
                  {DAYS.map((day, weekday) => (
                    <label
                      key={day}
                      className="flex h-7 w-10 cursor-pointer items-center justify-center rounded-md font-mono text-2xs text-muted-foreground/60 transition-colors duration-150 select-none hover:bg-white/[0.05] has-checked:bg-white/[0.07] has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
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
                </div>
              </td>
              <td className={cn(table.td, "w-px")}>
                <Button
                  variant="ghost-destructive"
                  size="icon-xs"
                  aria-label="Remove slot"
                  onClick={() => setEdit(edit.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className={cn(table.td, "border-b-0")}>
              <Button
                variant="ghost-muted"
                size="xs"
                className="-ml-2"
                onClick={() => add({ weekdayMask: 62, minuteOfDay: 540 })}
              >
                <Plus />
                Add slot
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="flex items-center gap-3 px-6 pt-2 pb-6">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || dayless}
          onClick={() => onSave(edit.map(strip))}
        >
          <TextMorph duration={250}>{dirty ? "Save" : "Saved"}</TextMorph>
        </Button>
        {edit.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            The queue needs at least one slot to place drafts.
          </span>
        ) : dayless ? (
          <span className="text-xs text-warning-foreground">Each slot needs a day.</span>
        ) : null}
      </div>
      <Companion>
        <BestHours heatmap={heatmap} empty={bestHoursEmpty} onAdd={add} />
      </Companion>
    </>
  );
}

import type { DraftPoll } from "@xtend/contracts";
import { Plus, X } from "lucide-react";

import { inputClass } from "../ui/field";
import { Select } from "../ui/select";

const POLL_DURATIONS = [
  [60, "1 hour"],
  [360, "6 hours"],
  [1440, "1 day"],
  [4320, "3 days"],
  [10080, "7 days"],
] as const;

const iconButton =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-[#1d9bf0] hover:bg-[#1d9bf0]/10";

export const NEW_POLL: DraftPoll = { options: ["", ""], durationMinutes: 1440 };

/**
 * X's poll editor: two to four choices, a length, and Remove poll (`onChange(null)`). Compose's
 * Options and Home's box both draw it; the desktop fills X's own poll from what it holds.
 */
export function PollEditor({
  poll,
  onChange,
}: {
  readonly poll: DraftPoll;
  readonly onChange: (poll: DraftPoll | null) => void;
}) {
  const last = poll.options.length - 1;
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border p-3 text-[13px]">
      {poll.options.map((o, i) => (
        // eslint-disable-next-line react/no-array-index-key -- options are plain strings; position is their identity.
        <div key={i} className="flex items-center gap-1.5">
          <input
            className={inputClass}
            aria-label={`Choice ${i + 1}`}
            placeholder={i < 2 ? `Choice ${i + 1}` : `Choice ${i + 1} (optional)`}
            value={o}
            maxLength={25}
            onChange={(e) =>
              onChange({
                ...poll,
                options: poll.options.map((x, j) => (j === i ? e.target.value : x)),
              })
            }
          />
          {i >= 2 ? (
            <button
              type="button"
              aria-label={`Remove choice ${i + 1}`}
              className={iconButton}
              onClick={() => onChange({ ...poll, options: poll.options.filter((_, j) => j !== i) })}
            >
              <X className="size-4" />
            </button>
          ) : null}
          {i === last && poll.options.length < 4 ? (
            <button
              type="button"
              aria-label="Add a choice"
              className={iconButton}
              onClick={() => onChange({ ...poll, options: [...poll.options, ""] })}
            >
              <Plus className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span>Poll length</span>
        <Select
          compact
          label="Poll length"
          value={poll.durationMinutes}
          onChange={(durationMinutes) => onChange({ ...poll, durationMinutes })}
          options={POLL_DURATIONS.map(([value, label]) => ({ value, label }))}
        />
      </div>
      <button
        type="button"
        className="-mx-3 -mb-3 cursor-pointer border-t border-border py-2.5 text-center text-error-foreground hover:bg-error-foreground/10"
        onClick={() => onChange(null)}
      >
        Remove poll
      </button>
    </div>
  );
}

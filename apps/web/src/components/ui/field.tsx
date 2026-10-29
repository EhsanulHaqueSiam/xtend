import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";

/** A text field, select or textarea: a hairline on the black canvas, brighter on hover and focus. */
export const inputClass =
  "w-full min-w-0 rounded-[var(--control-radius)] [&:is(textarea)]:rounded-xl border border-white/13 bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-hidden transition-[border-color] duration-150 [color-scheme:dark] placeholder:text-placeholder hover:border-white/20 focus-visible:border-white/30";

/** The same control 28px tall, for page headers, toolbars and dense rows. */
export const compactInputClass = cn(inputClass, "h-7 px-2 py-0 text-xs");

/**
 * One form row: the name on the left, the control on the right. A label
 * element, so clicking the name focuses the control. The default fits a detail
 * column; `wide` is a full-page form such as Settings, with the name over its
 * `hint` in a wider column and hairlines between rows.
 */
export function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "grid items-start",
        wide
          ? "grid-cols-[220px_minmax(0,1fr)] gap-6 border-b border-border py-3 text-sm last:border-b-0"
          : "grid-cols-[96px_minmax(0,1fr)] gap-3 py-1",
      )}
    >
      {/* Level with the first line of the control beside it. */}
      <span
        className={cn(
          "flex flex-col gap-0.5",
          wide ? "pt-1.5 text-foreground" : "pt-2 text-[12.5px] leading-5 text-muted-foreground",
        )}
      >
        {label}
        {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={cn("min-w-0", wide && "max-w-md")}>{children}</span>
    </label>
  );
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * A 24-hour time typed as HH:MM, the way every other time in the app reads. The native time
 * field follows the OS locale (AM/PM) and opens a native picker. Only a whole, valid time
 * reaches `onChange`, so a half-typed one never jumps; leaving the field restores the value.
 */
export function TimeField({
  value,
  onChange,
  label,
  className,
}: {
  /** "HH:MM", 24-hour. */
  readonly value: string;
  readonly onChange: (time: string) => void;
  readonly label?: string;
  readonly className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      placeholder="HH:MM"
      maxLength={5}
      className={cn(compactInputClass, "w-16 font-mono tabular-nums", className)}
      value={text ?? value}
      onChange={(e) => {
        setText(e.target.value);
        const m = TIME.exec(e.target.value.trim());
        if (m !== null) onChange(`${m[1]!.padStart(2, "0")}:${m[2]}`);
      }}
      onBlur={() => setText(null)}
    />
  );
}

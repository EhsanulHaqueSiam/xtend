import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** On or off. The knob slides 150ms on a click; nothing else moves. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Names the switch for screen readers when no label element wraps it. */
  readonly label?: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      // Rows that open on click hold switches; flipping one must not open the row too.
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="group relative inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-[9px] bg-white/13 outline-hidden transition-[background-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-checked:bg-success"
    >
      <span className="size-3.5 translate-x-0.5 rounded-full bg-foreground transition-[translate] duration-150 ease-[cubic-bezier(.23,1,.32,1)] group-aria-checked:translate-x-[14px]" />
    </button>
  );
}

/** A small label over a group of properties, as in the inspector. */
export function PropGroup({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="mt-5 mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-foreground/80">{title}</h3>
        {aside}
      </div>
      <div className="border-t border-border">{children}</div>
    </div>
  );
}

/**
 * One row of a properties list: the name on the left, the value or control on
 * the right, a hairline under it. A label element by default, so clicking the
 * name focuses or flips the control; rows holding several buttons pass `div`.
 */
export function Prop({
  label,
  children,
  as: As = "label",
  className,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly as?: "label" | "div";
  readonly className?: string;
}) {
  return (
    <As
      className={cn(
        "flex min-h-9 items-center justify-between gap-3 border-b border-border py-1",
        className,
      )}
    >
      <span className="shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-xs tabular-nums">
        {children}
      </span>
    </As>
  );
}

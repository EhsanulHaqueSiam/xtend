import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

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

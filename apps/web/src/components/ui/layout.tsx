import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * The shapes every screen is built from, so the tools read as one app:
 * a scrolling body, hairline-separated sections with a small label, tables
 * with mono numbers, one-line empty states, and the price next to a paid
 * action. No cards around groups: a group is a label and a hairline.
 */

/** The scrolling area under a PageHeader. */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>;
}

/** A group on a page: its label and actions on one line, the content under it, a hairline after. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  readonly title?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("border-b border-border px-6 py-5 last:border-b-0", className)}>
      {title !== undefined || aside !== undefined ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title !== undefined ? (
            <h2 className="text-[12.5px] font-semibold text-foreground/80">{title}</h2>
          ) : (
            <span />
          )}
          {aside !== undefined ? <div className="flex items-center gap-1.5">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One quiet line where content would be, plus the action that fills it. */
export function Empty({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

const usd = (n: number) => (n === 0 ? "free" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** A price, shown next to every paid action before it runs. */
export function Cost({ usd: amount }: { readonly usd: number }) {
  return (
    <span className="font-mono text-2xs text-muted-foreground tabular-nums">{usd(amount)}</span>
  );
}

/** A number with its label: label small and muted, value in mono. */
export function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: "up" | "down" | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-lg tabular-nums",
          tone === "up" && "text-success-foreground",
          tone === "down" && "text-error-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Table classes: hairline rows, muted headers, mono right-aligned numbers. */
export const table = {
  root: "w-full border-collapse text-[13px]",
  th: "h-9 border-b border-border px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-6 last:pr-6",
  td: "h-10 border-b border-border px-3 align-middle first:pl-6 last:pr-6",
  num: "text-right font-mono text-xs tabular-nums",
  row: "transition-colors duration-150 hover:bg-white/[0.03] data-[selected=true]:bg-white/[0.06]",
} as const;

import type { ReactNode } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { usd as formatUsd } from "../../state/costs";

/**
 * The shapes every screen is built from, so the tools read as one app:
 * a scrolling body, groups that are one panel each, tables with mono numbers,
 * empty states that sketch what will fill them, the price next to a paid
 * action, and the freshness of what a page shows.
 */

/** The scrolling area under a PageHeader. */
export function PageBody({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto pb-2", className)}>{children}</div>;
}

/**
 * A group on a page: one panel with, when titled, its name, one-line
 * description and actions on the first line. Panels never nest; inside one,
 * hairlines divide and rows start at the panel's padding (`--row-inset`).
 */
export function Section({
  title,
  description,
  aside,
  children,
  className,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={cn(
        "mx-6 my-3 rounded-xl border border-border bg-card px-4 pt-3 pb-4 [--row-inset:0px]",
        className,
      )}
    >
      {title !== undefined || aside !== undefined ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title !== undefined ? (
            <h2 className="flex min-w-0 items-baseline gap-2.5 text-[13px] font-semibold text-foreground">
              <span className="truncate">{title}</span>
              {description !== undefined ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {description}
                </span>
              ) : null}
            </h2>
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

/**
 * Where content will be: three faint rows sketching it, one line on where it
 * comes from and what it costs, and the action that fills it. Static: no shimmer.
 */
export function Empty({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div aria-hidden="true" className="mb-1 flex w-full max-w-sm flex-col gap-2">
        {SKETCH.map((width) => (
          <span key={width} className={cn("h-2 rounded-sm bg-white/[0.05]", width)} />
        ))}
      </div>
      <p className="max-w-md text-[13px] text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

const SKETCH = ["w-full", "w-4/5", "w-3/5 opacity-60"] as const;

/**
 * A price, shown next to every paid action before it runs: a rate-card amount
 * (exact, the same formatting as the quote labels), or a quote label from
 * `useQuoteLabel` such as "cached, free".
 */
export function Cost(
  props: ({ readonly usd: number } | { readonly label: string }) & {
    /** "solid" inside a primary button, where muted grey would vanish. */
    readonly tone?: "solid" | undefined;
  },
) {
  const text = "label" in props ? props.label : props.usd === 0 ? "free" : formatUsd(props.usd);
  return (
    <span
      className={cn(
        "font-mono text-2xs tabular-nums",
        props.tone === "solid" ? "opacity-70" : "text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

/** A number with its label: value in mono, label small and muted under it. A changed value morphs by place. */
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <TextMorph
        numbers
        duration={250}
        className={cn(
          "font-mono text-[22px] leading-7 tabular-nums",
          tone === "up" && "text-success-foreground",
          tone === "down" && "text-error-foreground",
          // Nothing to show yet: a faint dash, not a bold one that reads as a value.
          value === "–" && "text-muted-foreground/50",
        )}
      >
        {value}
      </TextMorph>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Stats side by side in one surface, a hairline between each. */
export const statRow = "grid divide-x divide-border [&>*]:px-5 [&>*:first-child]:pl-0";

const FRESHNESS = {
  live: "bg-success",
  fresh: "bg-muted-foreground",
  stale: "bg-warning",
  refreshing: "bg-info",
} as const;

/**
 * How current a page's data is, as one mono line in the header: a dot and a
 * fact. Observed data is "live" and needs no button; fetched data says its
 * age; "stale" is the one state that asks for a paid refresh.
 */
export function Freshness({
  state,
  children,
}: {
  readonly state: keyof typeof FRESHNESS;
  readonly children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 truncate font-mono text-2xs text-muted-foreground tabular-nums">
      <span className={cn("size-1.5 shrink-0 rounded-full", FRESHNESS[state])} />
      <TextMorph duration={250}>{children}</TextMorph>
    </span>
  );
}

/** Table classes: hairline rows, muted headers, mono right-aligned numbers. */
export const table = {
  root: "w-full border-collapse text-[13px]",
  th: "h-9 border-b border-border px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-(--row-inset) last:pr-(--row-inset)",
  td: "h-10 border-b border-border px-3 align-middle first:pl-(--row-inset) last:pr-(--row-inset)",
  num: "text-right font-mono text-xs tabular-nums",
  row: "transition-colors duration-150 hover:bg-white/[0.03] data-[selected=true]:bg-white/[0.06]",
} as const;

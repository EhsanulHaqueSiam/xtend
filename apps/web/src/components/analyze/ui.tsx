import type { AccountPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import { useId, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { table } from "../ui/layout";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : compact.format(n);
export const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export const engagementRate = (p: AccountPost): number =>
  p.views === null || p.views === 0
    ? 0
    : (p.likes + p.reposts + p.replies + p.quotes + p.bookmarks) / p.views;

export const errorText = (cause: Cause.Cause<unknown>): string => {
  const e = Cause.squash(cause);
  return e instanceof Error ? e.message : String(e);
};

/** `table` for a table inside a Section: the Section already pads the sides. */
export const insetTable = {
  ...table,
  // The Section's own hairline closes the table.
  root: cn(table.root, "[&_tbody_tr:last-child_td]:border-b-0"),
  th: cn(table.th, "first:pl-0 last:pr-0"),
  td: cn(table.td, "first:pl-0 last:pr-0"),
} as const;

/** Timestamps in dense rows, in the account's zone (Settings) like every other screen's. */
export { fmtWhen as when } from "../../lib/time";

/** The empty state inside a Section: one quiet line, and the action that fills it. */
export function Note({
  children,
  action,
}: {
  readonly children: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-[13px] text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/** A failed action's message, one line under the page header. */
export function ErrorBar({ children }: { readonly children: string | null }) {
  return children === null ? null : (
    <p
      role="alert"
      className="shrink-0 border-b border-border px-6 py-2 text-xs text-error-foreground"
    >
      {children}
    </p>
  );
}

/** Inline SVG line over a gradient area, fixed height, full width; first and last x labels. No library. */
export function LineChart({
  points,
  height = 120,
}: {
  readonly points: ReadonlyArray<{ readonly label: string; readonly value: number }>;
  readonly height?: number;
}) {
  const width = 600;
  const pad = 2;
  if (points.length < 2)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Not enough data for a chart yet.
      </p>
    );
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const first = points[0]!;
  const last = points.at(-1)!;
  const gradient = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {/* Stretched to the box, so the stroke opts out of scaling to stay 2px. */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full text-foreground"
        style={{ height }}
        role="img"
        aria-label={`${first.label} to ${last.label}, max ${fmt(max)}`}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity={0.16} />
            <stop offset="1" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${gradient})`} />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between font-mono text-2xs text-muted-foreground tabular-nums">
        <span>{first.label}</span>
        <span>max {fmt(max)}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

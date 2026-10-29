import type { AccountPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import { useId, useState, type ReactNode } from "react";

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

/** One focus stop for a history: pointer or arrows inspect samples on a fitted y range. */
export function LineChart({
  points,
  height = 120,
}: {
  readonly points: ReadonlyArray<{ readonly label: string; readonly value: number }>;
  readonly height?: number;
}) {
  const gradient = useId();
  const hint = useId();
  const [inspected, setInspected] = useState<number | null>(null);
  const width = 600;
  const pad = 2;
  if (points.length < 2)
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Not enough data for a chart yet.
      </p>
    );
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  // Breathing room keeps extrema and constant histories clear without forcing zero into the range.
  const margin = max === min ? Math.max(Math.abs(max) * 0.05, 1) : (max - min) * 0.1;
  const lower = min - margin;
  const upper = max + margin;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - lower) / (upper - lower)) * (height - pad * 2);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const first = points[0]!;
  const last = points.at(-1)!;
  const index = inspected === null ? null : Math.min(inspected, points.length - 1);
  const point = index === null ? null : points[index]!;
  const readout =
    point === null
      ? null
      : `${point.label} · ${point.value.toLocaleString("en", { maximumFractionDigits: 20 })}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label={`${first.label} to ${last.label} history`}
        aria-roledescription="history chart"
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={(index ?? 0) + 1}
        aria-valuetext={
          readout ??
          `${first.label} · ${first.value.toLocaleString("en", { maximumFractionDigits: 20 })}`
        }
        aria-describedby={hint}
        onFocus={() => setInspected((previous) => previous ?? 0)}
        onBlur={() => setInspected(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width === 0) return;
          const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
          setInspected(Math.round(ratio * (points.length - 1)));
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.matches(":focus")) setInspected(null);
        }}
        onKeyDown={(event) => {
          const current = index ?? 0;
          const next =
            event.key === "ArrowRight"
              ? current + 1
              : event.key === "ArrowLeft"
                ? current - 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? points.length - 1
                    : null;
          if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          setInspected(Math.max(0, Math.min(points.length - 1, next)));
        }}
      >
        {/* Stretched to the box, so the stroke opts out of scaling to stay 2px. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-full w-full text-foreground"
          aria-hidden="true"
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
          {index !== null && (
            <line
              x1={x(index)}
              x2={x(index)}
              y1={0}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.35}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {index !== null && point !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-2 -translate-1/2 rounded-full bg-foreground"
            style={{ left: `${(index / (points.length - 1)) * 100}%`, top: y(point.value) }}
          />
        )}
      </div>
      <div
        className="flex min-h-4 justify-between font-mono text-2xs text-muted-foreground tabular-nums"
        aria-live="polite"
        aria-atomic="true"
      >
        {readout === null ? (
          <>
            <span>{first.label}</span>
            <span>
              {fmt(min)} to {fmt(max)}
            </span>
            <span>{last.label}</span>
          </>
        ) : (
          <span className="text-foreground">{readout}</span>
        )}
      </div>
      <p id={hint} className="font-mono text-2xs text-muted-foreground">
        ← → point · Home End
      </p>
    </div>
  );
}

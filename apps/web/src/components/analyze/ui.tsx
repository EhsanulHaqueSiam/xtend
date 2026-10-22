import type { AccountPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import type { ReactNode } from "react";

import { Button } from "../ui/button";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : compact.format(n);
export const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
export const usd = (n: number) => `$${n.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

export const engagementRate = (p: AccountPost): number =>
  p.views === null || p.views === 0
    ? 0
    : (p.likes + p.reposts + p.replies + p.quotes + p.bookmarks) / p.views;

export const errorText = (cause: Cause.Cause<unknown>): string => {
  const e = Cause.squash(cause);
  return e instanceof Error ? e.message : String(e);
};

export const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  readonly tabs: ReadonlyArray<T>;
  readonly active: T;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5">
      {tabs.map((tab) => (
        <Button
          key={tab}
          variant="ghost"
          size="xs"
          data-active={tab === active ? "true" : undefined}
          className="text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
          onClick={() => onChange(tab)}
        >
          {tab}
        </Button>
      ))}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex h-9 items-center justify-between border-b border-border px-3">
        <h2 className="text-xs font-medium">{title}</h2>
        {actions}
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <span className="font-mono text-base font-medium">{value}</span>
      {sub !== undefined ? (
        <span className="font-mono text-2xs text-muted-foreground">{sub}</span>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ErrorText({ children }: { readonly children: string }) {
  return <p className="py-2 text-sm text-error-foreground">{children}</p>;
}

/** Inline SVG line, fixed height, first and last x labels. No library. */
export function LineChart({
  points,
  height = 120,
}: {
  readonly points: ReadonlyArray<{ readonly label: string; readonly value: number }>;
  readonly height?: number;
}) {
  const width = 600;
  const pad = 4;
  if (points.length < 2) return <Empty>Not enough data for a chart yet.</Empty>;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between font-mono text-2xs text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>max {fmt(max)}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

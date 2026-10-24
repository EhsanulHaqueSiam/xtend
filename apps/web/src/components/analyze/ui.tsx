import { useAtomSet } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { AccountPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import type { MouseEvent, ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { xNavigate, xPanelOpenAtom } from "../../state/x";
import { Button } from "../ui/button";
import { Empty as EmptyState, table } from "../ui/layout";

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

/** A compact control (input or select) for dense rows and page headers. */
export const fieldClass =
  "h-7 min-w-0 rounded-md border border-white/13 bg-background px-2 text-xs text-foreground outline-hidden transition-[border-color] duration-150 [color-scheme:dark] placeholder:text-placeholder hover:border-white/20 focus-visible:border-white/30";

/** `table` for a table inside a Section: the Section already pads the sides. */
export const insetTable = {
  ...table,
  // The Section's own hairline closes the table.
  root: cn(table.root, "[&_tbody_tr:last-child_td]:border-b-0"),
  th: cn(table.th, "first:pl-0 last:pr-0"),
  td: cn(table.td, "first:pl-0 last:pr-0"),
} as const;

/** "Oct 24, 09:12" in the viewer's zone, for timestamps in dense rows. */
const whenFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const when = (iso: string) => whenFormat.format(new Date(iso));

/** What a model-call action costs: the service quotes no price for one, so the button says so. */
export function ModelCall() {
  return <span className="font-mono text-2xs text-muted-foreground">model call</span>;
}

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

/** On the desktop an x.com link opens in the X panel beside the screen; in a browser, a new tab. */
export function useOpenOnX() {
  const setPanel = useAtomSet(xPanelOpenAtom);
  return (url: string) => {
    if (!isElectron) return void window.open(url, "_blank", "noreferrer");
    xNavigate(url);
    setPanel(true);
  };
}

/** A link to a post or profile on x.com that opens it beside the screen on the desktop. */
export function XLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const open = useOpenOnX();
  const onClick = (e: MouseEvent) => {
    if (!isElectron || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    open(href);
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("hover:underline", className)}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/**
 * Where a screen needs the account's handle and there is none yet. The service
 * adopts it from the signed-in X session, so the fix is signing in to X.
 */
export function NoHandle() {
  return isElectron ? (
    <EmptyState
      action={
        <Button size="sm" variant="outline" render={<Link to="/x" />}>
          Open X
        </Button>
      }
    >
      Sign in to X. Your handle comes from the session.
    </EmptyState>
  ) : (
    <EmptyState>Sign in to X in the desktop app. Your handle comes from the session.</EmptyState>
  );
}

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

/** Inline SVG line over a faint area, fixed height, full width; first and last x labels. No library. */
export function LineChart({
  points,
  height = 120,
}: {
  readonly points: ReadonlyArray<{ readonly label: string; readonly value: number }>;
  readonly height?: number;
}) {
  const width = 600;
  const pad = 2;
  if (points.length < 2) return <Empty>Not enough data for a chart yet.</Empty>;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const first = points[0]!;
  const last = points.at(-1)!;
  return (
    <div className="flex flex-col gap-1.5">
      {/* Stretched to the box, so the stroke opts out of scaling to stay 1.5px. */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full border-b border-border text-foreground"
        style={{ height }}
        role="img"
        aria-label={`${first.label} to ${last.label}, max ${fmt(max)}`}
      >
        <path d={`${line} L${width},${height} L0,${height} Z`} className="fill-white/4" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
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

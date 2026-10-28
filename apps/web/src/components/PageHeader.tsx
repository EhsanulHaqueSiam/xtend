import type { ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";

export interface HeaderTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * Filters inside one section, as a segmented pill: the open one on a white
 * thumb, the rest muted. A section's own sections belong in the sidebar.
 */
export function HeaderTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  readonly tabs: ReadonlyArray<HeaderTab<T>>;
  readonly value: T;
  readonly onChange: (id: T) => void;
  /** Names the group for screen readers, e.g. "Format". */
  readonly label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-drag flex min-w-0 items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="flex h-6 shrink-0 cursor-pointer items-baseline gap-1.5 rounded-full px-2.5 text-[12.5px] leading-6 text-muted-foreground outline-hidden transition-colors duration-150 hover:text-foreground focus-visible:text-foreground aria-selected:bg-foreground aria-selected:font-medium aria-selected:text-background"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="font-mono text-2xs tabular-nums opacity-60">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The top of every screen: 52px, the section's name (a long one truncates
 * before the actions do), an optional row of filters right after it, and the
 * screen's actions on the right. `detail` is a
 * short mono fact (a count, a date range) and never a sentence.
 */
export function PageHeader({
  title,
  leading,
  tabs,
  detail,
  actions,
}: {
  readonly title: string;
  /** Before the title: a back control on a screen opened from a list. */
  readonly leading?: ReactNode;
  readonly tabs?: ReactNode;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex h-(--workspace-topbar-height) shrink-0 items-center gap-5 bg-background px-6",
        isElectron && "drag-region",
      )}
    >
      {leading !== undefined ? <div className="no-drag -ml-2 shrink-0">{leading}</div> : null}
      <h1 className="min-w-0 max-w-[40%] shrink truncate text-[15px] font-semibold tracking-tight">
        {title}
      </h1>
      {tabs}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {detail !== undefined ? (
          <span className="truncate font-mono text-2xs text-muted-foreground tabular-nums">
            {detail}
          </span>
        ) : null}
        {actions !== undefined ? (
          <div className="no-drag flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

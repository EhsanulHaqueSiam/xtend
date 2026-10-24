import type { ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";

export interface HeaderTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number | undefined;
}

/**
 * Filters inside one section, as plain words: the open one in white, the rest
 * muted, no pill or underline. A section's own sections belong in the sidebar.
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
    <div role="tablist" aria-label={label} className="no-drag flex min-w-0 items-center gap-4">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="flex shrink-0 cursor-pointer items-baseline gap-1.5 text-[13.5px] text-muted-foreground outline-hidden transition-colors duration-150 hover:text-foreground focus-visible:text-foreground aria-selected:text-foreground"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The top of every screen: 52px, the section's name, an optional row of
 * filters right after it, and the screen's actions on the right. `detail` is a
 * short mono fact (a count, a date range) and never a sentence.
 */
export function PageHeader({
  title,
  tabs,
  detail,
  actions,
}: {
  readonly title: string;
  readonly tabs?: ReactNode;
  readonly detail?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex h-(--workspace-topbar-height) shrink-0 items-center gap-5 border-b border-border bg-background px-6",
        isElectron && "drag-region",
      )}
    >
      <h1 className="shrink-0 truncate text-[15px] font-semibold tracking-tight">{title}</h1>
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

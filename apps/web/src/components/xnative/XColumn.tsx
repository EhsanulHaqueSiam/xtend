import { createContext, useContext, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { DayGlance } from "../shell/HomeCompanion";
import { MediaViewer } from "./MediaViewer";

/** The element that scrolls an X screen; lists inside virtualize against it. */
const ScrollParent = createContext<HTMLElement | null>(null);
export const useXScrollParent = () => useContext(ScrollParent);

/**
 * X's own reading shape: one 600px column between hairlines, and Xtend's rail beside it (the
 * screen's own panels, then the day at a glance). The
 * whole area scrolls, as X's page does, so the wheel works over the rail too; the column header
 * and the rail stay put. Under 1100px the rail folds away.
 */
export function XColumn({
  header,
  float,
  rail,
  children,
}: {
  readonly header: ReactNode;
  /** Floats just under the header while the column scrolls, as X's "Show N posts" does. */
  readonly float?: ReactNode;
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  return (
    <div ref={setScroller} className="h-full min-h-0 overflow-y-auto [overflow-anchor:none]">
      <div className="flex min-h-full justify-center gap-7 px-4">
        <section
          data-x="column"
          className="relative flex min-h-full w-full max-w-[600px] min-w-0 flex-col border-x border-border"
        >
          <div
            className={cn(
              "sticky top-0 z-20 border-b border-border bg-black/90 backdrop-blur-md",
              isElectron && "drag-region",
            )}
          >
            {header}
            {float === undefined || float === null ? null : (
              <div className="no-drag absolute top-full left-1/2 mt-3 -translate-x-1/2">
                {float}
              </div>
            )}
          </div>
          <ScrollParent value={scroller}>{children}</ScrollParent>
          <MediaViewer />
        </section>
        <aside className="sticky top-0 flex h-fit w-[340px] shrink-0 flex-col gap-4 py-3 max-[1100px]:hidden">
          {rail}
          {/* Xtend's day beside every X screen, where X keeps its own right column. */}
          <section className="rounded-2xl border border-white/[0.12] px-4 pt-1 pb-0 [&>a:first-child]:border-t-0">
            <DayGlance />
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The column's title row: an optional back button, the title and a muted line under it. */
export function XTitle({
  title,
  detail,
  onBack,
  actions,
}: {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly onBack?: (() => void) | undefined;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[53px] items-center gap-6 px-4">
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back"
          className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
          onClick={onBack}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[19px] leading-6 font-bold tracking-[-0.01em]">{title}</h1>
        {detail === undefined ? null : (
          <p className="truncate text-[13px] text-[#71767b]">{detail}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="no-drag flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * X's tab row: plain words, the open one bold with a short blue bar under it. A few tabs share
 * the width; many scroll sideways, as X's pinned lists do.
 */
export function XTabs<Id extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  readonly label: string;
  readonly tabs: ReadonlyArray<{ readonly id: Id; readonly label: string }>;
  readonly value: Id;
  readonly onChange: (id: Id) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-drag flex overflow-x-auto [scrollbar-width:none]"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          className="group flex h-[53px] min-w-fit flex-1 cursor-pointer justify-center px-4 text-[15px] text-[#71767b] transition-colors duration-150 hover:bg-white/[0.06] aria-selected:font-bold aria-selected:text-foreground"
          onClick={() => onChange(t.id)}
        >
          <span className="flex flex-col justify-between pt-4 whitespace-nowrap">
            {t.label}
            <span className="h-1 rounded-full group-aria-selected:bg-[#1d9bf0]" />
          </span>
        </button>
      ))}
    </div>
  );
}

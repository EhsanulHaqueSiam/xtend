import type { ReactNode } from "react";

import { cn } from "../lib/utils";

/**
 * X's own control shapes, for pages drawn inside x.com: pill buttons, the grey action row with
 * a blue hover, sidebar cards and the small tab row. Colors come from the theme tokens, which
 * html.slot sets to X's.
 */
export const xPill =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[#536471] px-4 text-[15px] font-bold text-foreground transition-[background-color,scale] duration-150 hover:bg-accent active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
export const xPillSolid = cn(
  xPill,
  "border-[#eff3f4] bg-[#eff3f4] text-[#0f1419] hover:bg-[#d7dbdc]",
);
export const xPillSm = "h-8 px-3.5 text-sm";
export const xAction =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";
export const xIconButton =
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5";
export const xInput =
  "w-full rounded-md border border-border bg-transparent px-3 py-2 text-[15px] text-foreground outline-hidden placeholder:text-placeholder focus:border-primary";
const xCard = "overflow-hidden rounded-2xl border border-border";
const xCardTitle = "flex items-center gap-2 px-4 py-3 text-xl font-extrabold";
export const xMeta = "text-[13px] leading-4 text-muted-foreground";

/** X's second-level tab row: left aligned, a count after the label, the blue underline under the active one. */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: ReadonlyArray<{ readonly id: T; readonly label: string; readonly count?: number }>;
  readonly value: T;
  readonly onChange: (id: T) => void;
}) {
  return (
    <nav className="flex h-11 shrink-0 gap-1 overflow-x-auto border-b border-border px-2 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 cursor-pointer items-center whitespace-nowrap px-3 text-sm text-muted-foreground hover:bg-accent",
              on && "font-bold text-foreground",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 ? (
              // A real space, so the tab reads "Queued 2" rather than "Queued2".
              <span className="whitespace-pre font-normal text-muted-foreground"> {tab.count}</span>
            ) : null}
            {on ? (
              <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-sm bg-primary" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/** A right-column card: X's 16px radius, hairline and 20px extra-bold title. */
export function XCard({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className={xCard}>
      <h2 className={xCardTitle}>
        <span className="flex-1">{title}</span>
        {aside}
      </h2>
      {children}
    </section>
  );
}

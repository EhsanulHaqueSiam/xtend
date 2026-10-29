import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";

/**
 * The list-and-detail shape: a scrolling list across the width and the
 * selected item's detail in a column on its right. The list half has its rows
 * (`ListHead`, `ListRow`, j/k with `useSelection`), the detail half its numbers
 * (`Props`).
 */

/**
 * `detail` null closes the column; a new `detailKey` (the selected id) starts
 * it at its top. A `closable` detail (it has its own close control) takes the
 * whole width while the split is under 46rem, until it is closed. Triage lists
 * always hold a selection, so theirs stays beside the list.
 */
export function DetailSplit({
  list,
  detail,
  detailKey,
  label,
  closable = false,
  onClose,
}: {
  readonly list: ReactNode;
  readonly detail: ReactElement | null;
  readonly detailKey?: string | number | null;
  /** Names the column for screen readers. */
  readonly label?: string;
  readonly closable?: boolean;
  readonly onClose?: (() => void) | undefined;
}) {
  const cover = detail !== null && closable;
  const root = useRef<HTMLDivElement>(null);
  const listRoot = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousRow = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const previousKey = useRef(detailKey);
  useLayoutEffect(() => {
    if (detail !== null && (!wasOpen.current || detailKey !== previousKey.current)) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (detail === null && wasOpen.current && opener.current?.isConnected) {
      opener.current.focus();
    }
    wasOpen.current = detail !== null;
    previousKey.current = detailKey;
    const row =
      listRoot.current?.querySelector<HTMLElement>('[data-list-row][data-selected="true"]') ?? null;
    if (previousRow.current !== null && !previousRow.current.isConnected) row?.focus();
    previousRow.current = row;
  });
  useEffect(() => {
    if (detail === null || onClose === undefined) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      if (
        !(event.target instanceof Node) ||
        (!root.current?.contains(event.target) && event.target !== opener.current)
      )
        return;
      if (document.querySelector('[role="menu"], [role="dialog"], [data-detail-popup]')) return;
      event.preventDefault();
      onClose();
      if (opener.current?.isConnected) opener.current.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [detail, onClose]);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditable(event.target)
      )
        return;
      const step =
        event.key === "j" || event.key === "ArrowDown"
          ? 1
          : event.key === "k" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (step === 0 || !(event.target instanceof Node)) return;
      if (document.querySelector('[role="menu"], [role="dialog"], [data-detail-popup]')) return;
      const inSplit = root.current?.contains(event.target);
      // With one list, triage keys also work before a row has received focus.
      if (
        !inSplit &&
        (event.target !== document.body ||
          document.querySelectorAll("[data-selection-list]:has([data-list-row])").length !== 1)
      )
        return;
      const rows = [
        ...(listRoot.current?.querySelectorAll<HTMLButtonElement>("[data-list-row]") ?? []),
      ];
      const focused = rows.findIndex((row) => row.contains(event.target as Node));
      const index =
        focused === -1 ? rows.findIndex((row) => row.dataset.selected === "true") : focused;
      if (index === -1) return;
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
      next?.click();
      next?.focus();
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, []);
  return (
    <div ref={root} className="@container/split flex min-h-0 flex-1">
      <div
        ref={listRoot}
        data-selection-list
        className={cn(
          "@container/list min-w-0 flex-1 overflow-y-auto",
          cover && "@max-[46rem]/split:hidden",
        )}
      >
        {list}
      </div>
      {detail === null ? null : (
        <aside
          key={detailKey ?? undefined}
          aria-label={label}
          className={cn(
            "w-[min(380px,45%)] min-w-[300px] shrink-0 overflow-y-auto border-l border-border [counter-reset:section]",
            cover && "@max-[46rem]/split:w-full @max-[46rem]/split:border-l-0",
          )}
        >
          {detail}
        </aside>
      )}
    </div>
  );
}

/**
 * A right-hand column of a list: its label, width and visibility classes
 * (narrow lists hide the less useful ones with container queries), and what a
 * row shows.
 */
export interface Column<T> {
  readonly label: string;
  readonly className: string;
  readonly cell: (item: T) => ReactNode;
}

const grid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-6";

/** Column labels over a list, sticky while it scrolls. */
export function ListHead<T>({
  label,
  columns,
}: {
  readonly label: string;
  readonly columns: ReadonlyArray<Column<T>>;
}) {
  return (
    <div
      className={cn(
        grid,
        "sticky top-0 z-10 h-9 border-b border-border bg-background text-xs font-medium text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-x-3">
        {columns.map((c) => (
          <span key={c.label} className={cn("truncate text-right", c.className)}>
            {c.label}
          </span>
        ))}
      </span>
    </div>
  );
}

/** One row: free-form content on the left, the columns' mono values on the right. */
export function ListRow<T>({
  item,
  columns,
  selected,
  onSelect,
  muted,
  children,
}: {
  readonly item: T;
  readonly columns: ReadonlyArray<Column<T>>;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly muted?: boolean;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // j/k move the selection too, so the selected row scrolls into view when it changes.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      data-list-row
      data-selected={selected}
      aria-current={selected || undefined}
      className={cn(
        grid,
        "min-h-10 w-full cursor-pointer border-b border-border py-2 text-left text-[13px] outline-hidden transition-colors duration-150 hover:bg-white/[0.03] focus-visible:bg-white/[0.04] data-[selected=true]:bg-white/[0.06]",
        muted && "text-muted-foreground",
      )}
      onClick={onSelect}
    >
      <span className="min-w-0">{children}</span>
      <span className="flex items-center gap-x-3 font-mono text-xs tabular-nums">
        {columns.map((c) => (
          <span key={c.label} className={cn("truncate text-right", c.className)}>
            {c.cell(item)}
          </span>
        ))}
      </span>
    </button>
  );
}

/** A row's first line: who, then muted facts, then a `mark` (replied, handled) that never truncates. */
export function RowTitle({
  name,
  meta,
  mark,
}: {
  readonly name: ReactNode;
  readonly meta: ReactNode;
  readonly mark?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="max-w-[70%] shrink-0 truncate font-medium">{name}</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span>
      {mark !== undefined ? <span className="shrink-0 text-xs">{mark}</span> : null}
    </span>
  );
}

/** A row's second line: the post or reply text, one line. */
export function RowText({ children }: { readonly children: ReactNode }) {
  return <span className="mt-0.5 block truncate text-foreground/75">{children}</span>;
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The selected id of a list, kept valid as the list changes: when the selected
 * item leaves (handled, skipped) its neighbour takes its place. The first item
 * is selected until the user picks one. DetailSplit scopes j/k and arrows to its rows.
 */
export function useSelection<Id extends string | number>(ids: ReadonlyArray<Id>) {
  const [chosen, setChosen] = useState<{ readonly id: Id; readonly index: number } | null>(null);
  const found = chosen === null ? 0 : ids.indexOf(chosen.id);
  const index = found !== -1 ? found : Math.min(chosen?.index ?? 0, ids.length - 1);
  const selected = ids[index] ?? null;
  const select = (id: Id) => setChosen({ id, index: ids.indexOf(id) });

  return { selected, select } as const;
}

/** The detail column's numbers: label on the left, mono value on the right, hairlines between. */
export function Props({ rows }: { readonly rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] border-t border-border">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="border-b border-border py-1.5 pr-4 text-[12.5px] leading-5 text-muted-foreground">
            {label}
          </dt>
          <dd className="max-w-48 truncate border-b border-border py-1.5 text-right font-mono text-xs leading-5 tabular-nums">
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

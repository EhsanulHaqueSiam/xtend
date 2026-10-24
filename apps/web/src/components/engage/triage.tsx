import { useAtomSet } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { XPost } from "@xtend/contracts";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { xNavigate, xPanelOpenAtom } from "../../state/x";
import { Empty, Section } from "../ui/layout";
import { xPill, xPillSm, xPillSolid } from "../x";

/**
 * The triage shape Engage and Leads share: a dense list across the width and
 * the selected item's detail in a column on the right. j/k or the arrow keys
 * move the selection; the detail column holds the actions and their prices.
 */

export const pill = cn(xPill, xPillSm);
export const pillSolid = cn(xPillSolid, xPillSm);
/** A solid pill with a <Cost> as its last child: the price stays readable on white. */
export const pillSolidPriced = cn(pillSolid, "[&>span:last-child]:text-background/60");

/**
 * The list fills the width; `detail` (null for none) takes a column on the
 * right. A new `detailKey` (the selected id) starts the column at its top.
 */
export function Split({
  list,
  detail,
  detailKey,
}: {
  readonly list: ReactNode;
  readonly detail: ReactNode;
  readonly detailKey: string | number | null;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="@container min-w-0 flex-1 overflow-y-auto">{list}</div>
      {detail === null ? null : (
        <aside
          key={detailKey}
          className="w-[min(380px,45%)] min-w-[300px] shrink-0 overflow-y-auto border-l border-border"
        >
          {detail}
        </aside>
      )}
    </div>
  );
}

/**
 * A right-hand column: its label, width and visibility classes (narrow lists
 * hide the less useful ones with container queries), and what a row shows.
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
 * is selected until the user picks one. j/k and the arrows move it.
 */
export function useSelection<Id extends string | number>(ids: ReadonlyArray<Id>) {
  const [chosen, setChosen] = useState<{ readonly id: Id; readonly index: number } | null>(null);
  const found = chosen === null ? 0 : ids.indexOf(chosen.id);
  const index = found !== -1 ? found : Math.min(chosen?.index ?? 0, ids.length - 1);
  const selected = ids[index] ?? null;
  const select = (id: Id) => setChosen({ id, index: ids.indexOf(id) });

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    const step =
      event.key === "j" || event.key === "ArrowDown"
        ? 1
        : event.key === "k" || event.key === "ArrowUp"
          ? -1
          : 0;
    const next = step === 0 ? undefined : ids[Math.max(0, Math.min(ids.length - 1, index + step))];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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

/** On the desktop a post or profile opens in the X panel beside the tool; in a browser, a new tab. */
function useOpenOnX() {
  const setPanel = useAtomSet(xPanelOpenAtom);
  return (url: string) => {
    if (!isElectron) return void window.open(url, "_blank", "noreferrer");
    xNavigate(url);
    setPanel(true);
  };
}

/** "Open on X" for the detail column's action row. */
export function OpenOnX({
  url,
  label = "Open on X",
}: {
  readonly url: string;
  readonly label?: string;
}) {
  const open = useOpenOnX();
  return (
    <button type="button" className={pill} onClick={() => open(url)}>
      {label}
      <ArrowUpRight className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/** The top of a post's detail: author, when, the full text, then the actions. */
export function PostHead({
  post,
  meta,
  actions,
}: {
  readonly post: XPost;
  readonly meta: string;
  readonly actions: ReactNode;
}) {
  return (
    <Section>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="truncate">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" aria-label="verified" />
        ) : null}
      </div>
      <p className="truncate text-[12.5px] text-muted-foreground">
        @{post.author.handle} · {meta}
      </p>
      <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{post.text}</p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">{actions}</div>
    </Section>
  );
}

/** A failure from the service, in the place the result would have gone. */
export function ErrorLine({ children }: { readonly children: string }) {
  return <p className="px-6 py-3 text-xs text-error-foreground">{children}</p>;
}

/**
 * For what needs the user's own handle. The service reads it from the
 * signed-in X session, so the fix is signing in there, not a setting.
 * `subject` starts the line: "Mentions need".
 */
export function NoHandle({ subject }: { readonly subject: string }) {
  const navigate = useNavigate();
  return (
    <Empty
      action={
        isElectron ? (
          <button type="button" className={pill} onClick={() => void navigate({ to: "/x" })}>
            Open X
          </button>
        ) : undefined
      }
    >
      {isElectron
        ? `${subject} your handle, which comes from the signed-in X session.`
        : `${subject} your handle, which the desktop app reads from the signed-in X session.`}
    </Empty>
  );
}

/** "3m", "2h", "5d": lists are dense, so no words. */
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

import { useNavigate } from "@tanstack/react-router";
import type { EngineUser } from "@xtend/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";

import { xScrollMore } from "../../state/x";
import { Empty } from "../ui/layout";
import { useXScrollParent } from "./XColumn";
import { Avatar, Verified } from "./XPostView";

/** How often a list may ask X for its next page; X's own scrolling pace, not faster. */
const MORE_EVERY_MS = 1500;

/** How long a screen waits for X's first answer before it says so and offers x.com itself. */
const QUIET_MS = 12_000;

/**
 * Asks X's own page for its next page, at X's pace. Virtuoso fires endReached once per list
 * length, so a call inside the pause runs at its end instead of being dropped; a dropped one
 * would stall the list at its last row.
 */
export function useMore() {
  const last = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(trailing.current ?? undefined), []);
  const more = () => {
    const wait = last.current + MORE_EVERY_MS - Date.now();
    if (wait > 0) {
      trailing.current ??= setTimeout(() => {
        trailing.current = null;
        more();
      }, wait);
      return;
    }
    last.current = Date.now();
    void xScrollMore();
  };
  return more;
}

/**
 * An X screen with nothing yet: its loading line, then, if X stays quiet, that it has not sent
 * this, with a way to ask again or see x.com itself. Mount it keyed by the surface, so a new
 * surface starts a fresh wait.
 */
export function XEmpty({
  empty,
  onReopen,
}: {
  readonly empty: ReactNode;
  readonly onReopen: () => void;
}) {
  const navigate = useNavigate();
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuiet(true), QUIET_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Empty
      action={
        quiet ? (
          <span className="flex gap-2">
            <button
              type="button"
              className="h-8 cursor-pointer rounded-full bg-foreground px-3.5 text-[13px] font-bold text-background"
              onClick={onReopen}
            >
              Load again
            </button>
            <button
              type="button"
              className="h-8 cursor-pointer rounded-full border border-white/[0.18] px-3.5 text-[13px] font-bold hover:bg-white/[0.06]"
              onClick={() => void navigate({ to: "/x" })}
            >
              Show x.com here
            </button>
          </span>
        ) : undefined
      }
    >
      {quiet ? "X has not sent this yet. It may be signed out or slow." : empty}
    </Empty>
  );
}

/**
 * Any X list that is not posts (notifications, people, trends, Lists), virtualized against the
 * column's scroll. Reaching the end scrolls X's own page so X fetches the next one.
 */
export function XRows<A>({
  waitKey,
  items,
  rowKey,
  row,
  empty,
  onReopen,
  paged = true,
}: {
  /** What the list shows (its surface): a new one starts a fresh wait for X. */
  readonly waitKey: string;
  readonly items: ReadonlyArray<A>;
  readonly rowKey: (item: A) => string;
  readonly row: (item: A, index: number) => ReactNode;
  readonly empty: ReactNode;
  /** Asks X for the page again, when it stayed quiet. */
  readonly onReopen: () => void;
  /** X pages this list on scroll; false for lists X sends whole. */
  readonly paged?: boolean;
}) {
  const scroller = useXScrollParent();
  const more = useMore();
  if (items.length === 0) return <XEmpty key={waitKey} empty={empty} onReopen={onReopen} />;
  if (scroller === null) return null;
  return (
    <Virtuoso
      customScrollParent={scroller}
      data={items}
      computeItemKey={(_, item) => rowKey(item)}
      increaseViewportBy={800}
      {...(paged ? { endReached: more } : {})}
      itemContent={(index, item) => row(item, index)}
    />
  );
}

/** A person as X lists them: face, name, handle, "Follows you", bio; a click opens the profile. */
export function UserRow({ user }: { readonly user: EngineUser }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-x="user"
      className="grid w-full cursor-pointer grid-cols-[40px_minmax(0,1fr)] gap-x-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
      onClick={() => void navigate({ to: "/u/$handle", params: { handle: user.handle } })}
    >
      <Avatar url={user.avatarUrl} size={40} />
      <span className="min-w-0 text-[15px] leading-5">
        <span className="flex items-center gap-1">
          <b className="truncate font-bold">{user.name}</b>
          {user.verified ? <Verified /> : null}
        </span>
        <span className="flex items-center gap-1.5 text-[#71767b]">
          <span className="truncate">@{user.handle}</span>
          {user.followsYou ? (
            <span className="shrink-0 rounded bg-white/[0.08] px-1 text-[12px]">Follows you</span>
          ) : null}
        </span>
        {user.bio === "" ? null : <span className="mt-1 line-clamp-2 block">{user.bio}</span>}
      </span>
    </button>
  );
}

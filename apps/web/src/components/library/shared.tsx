import { LIBRARY_PAGE_SIZE, type PostFormat, type XPost } from "@xtend/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { xPill, xPillSm } from "../x";

/** Shared bits for the Library and Scores screens: post formatting, errors, links. */

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : compact.format(n);

/** Engagements over views, or null when X did not report views. */
export const engagement = (m: XPost["metrics"]): number | null =>
  m.views === null || m.views === 0
    ? null
    : (m.likes + m.reposts + m.replies + m.quotes + m.bookmarks) / m.views;

export const erLabel = (m: XPost["metrics"]) => {
  const er = engagement(m);
  return er === null ? "–" : `${(er * 100).toFixed(1)}%`;
};

export const ago = (iso: string, nowMs = Date.now()) => {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 60 / 24)}d`;
};

/** What a post is made of, from its flags; only the archive knows threads (the model's call). */
export const formatOf = (post: XPost): Exclude<PostFormat, "thread"> =>
  post.hasMedia ? "media" : post.hasLink ? "link" : "text";

/** Promise rejections from `useAtomSet(..., { mode: "promise" })` carry the typed error. */
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Something failed.";

/** The readable failure of an AsyncResult. */
export const causeMessage = (cause: Cause.Cause<unknown>) => errorMessage(Cause.squash(cause));

export function ErrorLine({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <p className={cn("px-6 py-2 text-xs text-error-foreground", className)}>{children}</p>;
}

/** Past this many cards the grid is long enough; a search or a filter finds the rest faster. */
const MAX_SHOWN = 1000;

/** Under a paged grid: how many of the total show, and Show more for the next page. */
export function ShowMore({
  shown,
  total,
  waiting,
  onMore,
  past,
}: {
  readonly shown: number;
  readonly total: number;
  readonly waiting: boolean;
  readonly onMore: () => void;
  /** What to do instead once MAX_SHOWN are on screen. */
  readonly past: string;
}) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-2.5 px-6 pb-6">
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {shown.toLocaleString("en")} of {total.toLocaleString("en")}
      </span>
      {shown >= MAX_SHOWN ? (
        <span className="text-xs text-muted-foreground">{past}</span>
      ) : (
        <button type="button" className={cn(xPill, xPillSm)} disabled={waiting} onClick={onMore}>
          {waiting ? "Loading" : `Show ${Math.min(LIBRARY_PAGE_SIZE, total - shown)} more`}
        </button>
      )}
    </div>
  );
}

/**
 * A link to another screen by href, so it holds whatever that screen's search
 * params become (`/compose?tab=automatic`) without importing its route types.
 */
export function AppLink({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <a
      href={router.history.createHref(href)}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({ href });
      }}
    >
      {children}
    </a>
  );
}

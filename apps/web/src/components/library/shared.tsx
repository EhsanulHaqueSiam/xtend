import type { PostFormat, XPost } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import { BadgeCheck, ExternalLink, Image, Link as LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Shared bits for the Library and Scores screens: inputs, post formatting, errors. */

export const inputClass =
  "w-full rounded-[var(--control-radius)] border border-white/13 bg-transparent px-2.5 py-1.5 text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground focus:border-white/30";

/** A compact control in a page header or toolbar: same hairline, 28px tall. */
export const controlClass =
  "h-7 rounded-[var(--control-radius)] border border-white/13 bg-transparent px-2 text-xs text-foreground outline-hidden placeholder:text-muted-foreground focus:border-white/30";

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

/** Plain-word tabs; kept for callers outside the sidebar's sections. */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  readonly tabs: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly active: T;
  readonly onChange: (id: T) => void;
}) {
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-4 border-b border-border px-6"
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className="cursor-pointer text-[13.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground aria-selected:text-foreground"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** One post as a list row, for lists that are not a card grid. Actions render under the metrics. */
export function PostRow({
  post,
  badge,
  actions,
  children,
}: {
  readonly post: XPost;
  readonly badge?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <article className="border-b border-border px-6 py-3.5 transition-colors duration-150 hover:bg-white/[0.03]">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="truncate font-medium">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-foreground/70" />
        ) : null}
        <span className="truncate text-muted-foreground">@{post.author.handle}</span>
        {badge}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-2xs text-muted-foreground tabular-nums">
          {post.hasMedia ? <Image className="size-3" aria-label="media" /> : null}
          {post.hasLink ? <LinkIcon className="size-3" aria-label="link" /> : null}
          {post.author.followers !== null ? `${fmt(post.author.followers)} followers` : null}
          <span>{ago(post.createdAt)}</span>
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on X"
            className="hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </a>
        </span>
      </div>
      <p className="mt-1 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">
        {post.text}
      </p>
      <p className="mt-2 flex flex-wrap gap-x-3 font-mono text-2xs text-muted-foreground tabular-nums">
        <span>{fmt(post.metrics.views)} views</span>
        <span>{fmt(post.metrics.likes)} likes</span>
        <span>{fmt(post.metrics.reposts)} reposts</span>
        <span>{fmt(post.metrics.replies)} replies</span>
        <span>{erLabel(post.metrics)} ER</span>
      </p>
      {actions !== undefined ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>
      ) : null}
      {children}
    </article>
  );
}

/** Kept for callers that have no PageBody: one quiet line, centred. */
export function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function ErrorLine({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <p className={cn("px-6 py-2 text-xs text-error-foreground", className)}>{children}</p>;
}

/** Where a model call stands in for a price: Assist calls have no quote yet. */
export function ModelCost() {
  return <span className="font-mono text-2xs text-muted-foreground">model</span>;
}

import type { XPost } from "@xtend/contracts";
import { BadgeCheck, ExternalLink, Image, Link as LinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";

/** Shared bits for the Library and Engage screens: tab row, post row, formatting. */

export const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

const engagementRate = (m: XPost["metrics"]): string => {
  if (m.views === null || m.views === 0) return "–";
  return `${(((m.likes + m.reposts + m.replies + m.quotes + m.bookmarks) / m.views) * 100).toFixed(2)}%`;
};

const ago = (iso: string, nowMs = Date.now()) => {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 60 / 24)}d`;
};

/** Promise rejections from `useAtomSet(..., { mode: "promise" })` carry the typed error. */
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Something failed.";

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
    <div className="flex shrink-0 gap-1 border-b border-border px-3 py-1.5" role="tablist">
      {tabs.map((t) => (
        <Button
          key={t.id}
          role="tab"
          variant="ghost"
          size="xs"
          data-active={t.id === active ? "true" : undefined}
          aria-selected={t.id === active}
          className="text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-2xs text-muted-foreground">
      {label}
      <span
        className={
          tone === "success" ? "font-medium text-success-foreground" : "font-medium text-foreground"
        }
      >
        {value}
      </span>
    </span>
  );
}

/** One post as every library and engage list shows it. Actions render under the metrics. */
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
    <article className="rounded-lg px-3 py-2.5 hover:bg-accent/60">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-info-foreground" />
        ) : null}
        <span className="truncate text-muted-foreground">@{post.author.handle}</span>
        {badge}
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-2xs text-muted-foreground">
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
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
        {post.text}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono">
        <Metric label="views" value={fmt(post.metrics.views)} />
        <Metric label="likes" value={fmt(post.metrics.likes)} />
        <Metric label="reposts" value={fmt(post.metrics.reposts)} />
        <Metric label="replies" value={fmt(post.metrics.replies)} />
        <Metric label="ER" value={engagementRate(post.metrics)} tone="success" />
      </div>
      {actions !== undefined ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>
      ) : null}
      {children}
    </article>
  );
}

export function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function ErrorLine({ children }: { readonly children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-error-foreground">{children}</p>;
}

import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ObservedPostSummary } from "@corvid/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck, RefreshCw } from "lucide-react";

import { recentPostsAtom } from "../state/observations";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui/button";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

function engagementRate(post: ObservedPostSummary): string {
  const { views, likes, reposts, replies, quotes, bookmarks } = post.metrics;
  if (views === null || views === 0) return "–";
  return `${(((likes + reposts + replies + quotes + bookmarks) / views) * 100).toFixed(2)}%`;
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

function PostRow({ post }: { readonly post: ObservedPostSummary }) {
  return (
    <article className="group rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-accent/60">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate font-medium">{post.author.name}</span>
        {post.author.verified ? (
          <BadgeCheck className="size-3.5 shrink-0 text-info-foreground" />
        ) : null}
        <span className="truncate text-muted-foreground">@{post.author.handle}</span>
        {post.author.followers !== null ? (
          <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
            {fmt(post.author.followers)} followers
          </span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
        {post.text}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 font-mono">
        <Metric label="views" value={fmt(post.metrics.views)} />
        <Metric label="likes" value={fmt(post.metrics.likes)} />
        <Metric label="reposts" value={fmt(post.metrics.reposts)} />
        <Metric label="replies" value={fmt(post.metrics.replies)} />
        <Metric label="bookmarks" value={fmt(post.metrics.bookmarks)} />
        <Metric label="ER" value={engagementRate(post)} tone="success" />
        <span className="text-2xs text-muted-foreground">seen {post.observations}×</span>
      </div>
    </article>
  );
}

function Empty({ children }: { readonly children: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** Everything the session view has shown, newest sighting first. */
export function SeenFeed() {
  const result = useAtomValue(recentPostsAtom);
  const refresh = useAtomRefresh(recentPostsAtom);
  const count = AsyncResult.getOrElse(
    AsyncResult.map(result, (value) => value.posts.length),
    () => null,
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Seen"
        detail={count === null ? undefined : `${count} posts`}
        actions={
          <Button variant="ghost-muted" size="icon-sm" aria-label="Refresh" onClick={refresh}>
            <RefreshCw className={result.waiting ? "animate-status-pulse" : undefined} />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {AsyncResult.match(result, {
          onInitial: () => <Empty>Connecting to the service…</Empty>,
          onFailure: (failure) => (
            <Empty>{`Could not load observations: ${String(failure.cause)}`}</Empty>
          ),
          onSuccess: ({ value }) =>
            value.posts.length === 0 ? (
              <Empty>
                Nothing yet. Browse x.com in the desktop app and posts will show up here with their
                numbers.
              </Empty>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 py-2">
                {value.posts.map((post) => (
                  <PostRow key={post.postId} post={post} />
                ))}
              </div>
            ),
        })}
      </div>
    </div>
  );
}

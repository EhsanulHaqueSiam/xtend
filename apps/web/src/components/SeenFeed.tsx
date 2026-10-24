import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ObservedPostSummary } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck, RefreshCw } from "lucide-react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { recentPostsAtom } from "../state/observations";
import { PageHeader } from "./PageHeader";
import { Button } from "./ui/button";
import { Empty, PageBody, table } from "./ui/layout";
import { useOpenOnX } from "./ui/x-link";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

function engagementRate(post: ObservedPostSummary): string {
  const { views, likes, reposts, replies, quotes, bookmarks } = post.metrics;
  if (views === null || views === 0) return "–";
  return `${(((likes + reposts + replies + quotes + bookmarks) / views) * 100).toFixed(1)}%`;
}

const statusUrl = (post: ObservedPostSummary) =>
  `https://x.com/${post.author.handle}/status/${post.postId}`;

function PostRow({
  post,
  onOpen,
}: {
  readonly post: ObservedPostSummary;
  readonly onOpen: (post: ObservedPostSummary) => void;
}) {
  return (
    <tr className={cn(table.row, "cursor-pointer")} onClick={() => onOpen(post)}>
      <td className={cn(table.td, "w-56")}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{post.author.name}</span>
          {post.author.verified ? (
            <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
        </div>
        <div className="truncate font-mono text-2xs text-muted-foreground">
          @{post.author.handle}
          {post.author.followers !== null ? ` · ${fmt(post.author.followers)}` : ""}
        </div>
      </td>
      <td className={table.td}>
        <p className="line-clamp-2 max-w-2xl text-[13px] leading-snug text-foreground/90">
          {post.text}
        </p>
      </td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.views)}</td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.likes)}</td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.reposts)}</td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.replies)}</td>
      <td className={cn(table.td, table.num)}>{engagementRate(post)}</td>
      <td className={cn(table.td, table.num, "text-muted-foreground")}>{post.observations}×</td>
    </tr>
  );
}

/** Everything the X session has shown, newest sighting first: free, read from X's own traffic. */
export function SeenFeed() {
  const result = useAtomValue(recentPostsAtom);
  const refresh = useAtomRefresh(recentPostsAtom);
  const openOnX = useOpenOnX();
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
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={refresh}>
            <RefreshCw />
          </Button>
        }
      />
      <PageBody>
        {AsyncResult.match(result, {
          onInitial: () => <Empty>Connecting to the service.</Empty>,
          onFailure: (failure) => (
            <Empty>{`Could not load observations: ${String(failure.cause)}`}</Empty>
          ),
          onSuccess: ({ value }) =>
            value.posts.length === 0 ? (
              <Empty>
                {isElectron
                  ? "Nothing yet. Posts you scroll past on X land here with their numbers."
                  : "Nothing yet. Browse X in the desktop app and posts land here with their numbers."}
              </Empty>
            ) : (
              <table className={table.root}>
                <thead>
                  <tr>
                    <th className={table.th}>Author</th>
                    <th className={table.th}>Post</th>
                    <th className={cn(table.th, "text-right")}>Views</th>
                    <th className={cn(table.th, "text-right")}>Likes</th>
                    <th className={cn(table.th, "text-right")}>Reposts</th>
                    <th className={cn(table.th, "text-right")}>Replies</th>
                    <th className={cn(table.th, "text-right")}>ER</th>
                    <th className={cn(table.th, "text-right")}>Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {value.posts.map((post) => (
                    <PostRow key={post.postId} post={post} onOpen={(p) => openOnX(statusUrl(p))} />
                  ))}
                </tbody>
              </table>
            ),
        })}
      </PageBody>
    </div>
  );
}

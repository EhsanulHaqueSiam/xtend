import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Mark, ObservedPostSummary } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck, RefreshCw } from "lucide-react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { errorText } from "./analyze/ui";
import { recentPostsAtom } from "../state/observations";
import { PageHeader } from "./PageHeader";
import { useDropPost } from "./shell/drops";
import { Button } from "./ui/button";
import { Cost, Empty, PageBody, table } from "./ui/layout";
import { Marks, useMarks } from "./ui/marks";
import { useOpenOnX } from "./ui/x-link";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

function engagementRate(post: ObservedPostSummary): string {
  const { views, likes, reposts, replies, quotes, bookmarks } = post.metrics;
  if (views === null || views === 0) return "–";
  return `${(((likes + reposts + replies + quotes + bookmarks) / views) * 100).toFixed(1)}%`;
}

// Reposts, replies, ER and sightings give way first when the window narrows.
const wide = "max-xl:hidden";

const statusUrl = (post: ObservedPostSummary) =>
  `https://x.com/${post.author.handle}/status/${post.postId}`;

function PostRow({
  post,
  marks,
  onOpen,
  onSave,
}: {
  readonly post: ObservedPostSummary;
  readonly marks: ReadonlyArray<Mark> | undefined;
  readonly onOpen: (post: ObservedPostSummary) => void;
  readonly onSave: (post: ObservedPostSummary) => void;
}) {
  return (
    // Dragged like a post on X: the row carries its status URL, so every sidebar drop takes it.
    <tr
      draggable
      tabIndex={0}
      className={cn(table.row, "cursor-pointer outline-hidden focus-visible:bg-white/[0.04]")}
      onClick={() => onOpen(post)}
      onKeyDown={(e) => {
        // The row's own Enter; Enter on Save stays Save's.
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen(post);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/uri-list", statusUrl(post));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <td className={cn(table.td, "w-40 xl:w-56")}>
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
        <Marks marks={marks} />
      </td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.views)}</td>
      <td className={cn(table.td, table.num)}>{fmt(post.metrics.likes)}</td>
      <td className={cn(table.td, table.num, wide)}>{fmt(post.metrics.reposts)}</td>
      <td className={cn(table.td, table.num, wide)}>{fmt(post.metrics.replies)}</td>
      <td className={cn(table.td, table.num, wide)}>{engagementRate(post)}</td>
      <td className={cn(table.td, table.num, wide, "text-muted-foreground")}>
        {post.observations}×
      </td>
      <td className={cn(table.td, "whitespace-nowrap")}>
        {marks?.some((m) => m.kind === "saved") ? (
          <span className="px-3 text-xs text-muted-foreground">Saved</span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onSave(post);
            }}
          >
            Save <Cost usd={0} />
          </Button>
        )}
      </td>
    </tr>
  );
}

/** Everything the X session has shown, newest sighting first: free, read from X's own traffic. */
export function SeenFeed() {
  const result = useAtomValue(recentPostsAtom);
  const refresh = useAtomRefresh(recentPostsAtom);
  const openOnX = useOpenOnX();
  const drop = useDropPost();
  const count = AsyncResult.getOrElse(
    AsyncResult.map(result, (value) => value.posts.length),
    () => null,
  );
  const marks = useMarks(
    AsyncResult.getOrElse(
      AsyncResult.map(result, (value) =>
        value.posts.map((p) => ({ postId: p.postId, handle: p.author.handle })),
      ),
      () => [],
    ),
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
            <Empty>{`Could not load observations: ${errorText(failure.cause)}`}</Empty>
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
                    <th className={cn(table.th, "text-right", wide)}>Reposts</th>
                    <th className={cn(table.th, "text-right", wide)}>Replies</th>
                    <th className={cn(table.th, "text-right", wide)}>ER</th>
                    <th className={cn(table.th, "text-right", wide)}>Seen</th>
                    <th className={table.th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {value.posts.map((post) => (
                    <PostRow
                      key={post.postId}
                      post={post}
                      marks={marks[post.postId]}
                      onOpen={(p) => openOnX(statusUrl(p))}
                      onSave={(p) =>
                        drop("/library", {
                          postId: p.postId,
                          handle: p.author.handle,
                          url: statusUrl(p),
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            ),
        })}
      </PageBody>
    </div>
  );
}

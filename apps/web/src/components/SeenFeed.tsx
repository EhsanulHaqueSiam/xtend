import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Mark, ObservedPostSummary } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck, RefreshCw } from "lucide-react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
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

// Under 720px of width (the X panel docked) a row stacks: author and Save, text, then the numbers.
// `!` because the table cell's `first:pl-6` outranks a plain container variant.
const stack = "@max-[720px]:h-auto @max-[720px]:border-0 @max-[720px]:p-0!";

/** A number cell. A stacked row has no header, so its numbers carry their names. */
function Num({ value, name }: { readonly value: string; readonly name?: string }) {
  return (
    <td className={cn(table.td, table.num, stack)}>
      {value}
      {name === undefined ? null : (
        <span className="text-muted-foreground @min-[720px]:hidden"> {name}</span>
      )}
    </td>
  );
}

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
      className={cn(
        table.row,
        "cursor-pointer outline-hidden focus-visible:bg-white/[0.04]",
        "@max-[720px]:flex @max-[720px]:flex-wrap @max-[720px]:items-center @max-[720px]:gap-x-2 @max-[720px]:border-b @max-[720px]:border-border @max-[720px]:px-4 @max-[720px]:py-2",
      )}
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
      <td
        className={cn(
          table.td,
          "w-56",
          stack,
          "@max-[720px]:-order-2 @max-[720px]:w-auto @max-[720px]:min-w-0 @max-[720px]:flex-1",
        )}
      >
        <div className="min-w-0 @max-[720px]:flex @max-[720px]:items-baseline @max-[720px]:gap-1.5">
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
        </div>
      </td>
      <td className={cn(table.td, stack, "@max-[720px]:w-full")}>
        <p className="line-clamp-2 max-w-2xl text-[13px] leading-snug text-foreground/90 @max-[720px]:my-1 @max-[720px]:line-clamp-4">
          {post.text}
        </p>
        <Marks marks={marks} />
      </td>
      <Num value={fmt(post.metrics.views)} name="views" />
      <Num value={fmt(post.metrics.likes)} name="likes" />
      <Num value={fmt(post.metrics.reposts)} name="reposts" />
      <Num value={fmt(post.metrics.replies)} name="replies" />
      <Num value={engagementRate(post)} name="ER" />
      <Num value={`${post.observations}×`} />
      <td className={cn(table.td, "whitespace-nowrap", stack, "@max-[720px]:-order-1")}>
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
              <div className="@container">
                <table className={cn(table.root, "@max-[720px]:block")}>
                  <thead className="@max-[720px]:hidden">
                    <tr>
                      <th className={table.th}>Author</th>
                      <th className={table.th}>Post</th>
                      <th className={cn(table.th, "text-right")}>Views</th>
                      <th className={cn(table.th, "text-right")}>Likes</th>
                      <th className={cn(table.th, "text-right")}>Reposts</th>
                      <th className={cn(table.th, "text-right")}>Replies</th>
                      <th className={cn(table.th, "text-right")}>ER</th>
                      <th className={cn(table.th, "text-right")}>Seen</th>
                      <th className={table.th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="@max-[720px]:block">
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
              </div>
            ),
        })}
      </PageBody>
    </div>
  );
}

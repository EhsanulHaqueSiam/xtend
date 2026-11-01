import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Mark, ObservationCursor, ObservedPostSummary } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { BadgeCheck, RefreshCw, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { errorText } from "./analyze/ui";
import { seenPageAtom } from "../state/observations";
import { PageHeader } from "./PageHeader";
import { useDropPost } from "./shell/drops";
import { Button } from "./ui/button";
import { Cost, Empty, PageBody, table } from "./ui/layout";
import { Marks, useMarks } from "./ui/marks";
import { useOpenOnX } from "./ui/x-link";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number | null) => (n === null ? "–" : compact.format(n));

function engagementRate(post: ObservedPostSummary): string {
  const { views, likes, reposts, replies, quotes, bookmarks } = post.metrics;
  if (views === null || views === 0) return "–";
  return `${(((likes + reposts + replies + quotes + bookmarks) / views) * 100).toFixed(1)}%`;
}

// Under 960px of width (the X panel docked beside a laptop-width window) a row stacks: author and Save, text, then the numbers.
// `!` because the table cell's `first:pl-6` outranks a plain container variant.
const stack = "@max-[960px]:h-auto @max-[960px]:border-0 @max-[960px]:p-0!";

/** A number cell. A stacked row has no header, so its numbers carry their names. */
function Num({ value, name }: { readonly value: string; readonly name?: string }) {
  return (
    <td className={cn(table.td, table.num, stack)}>
      {value}
      {name === undefined ? null : (
        <span className="text-muted-foreground @min-[960px]:hidden"> {name}</span>
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
  onAuthor,
}: {
  readonly post: ObservedPostSummary;
  readonly marks: ReadonlyArray<Mark> | undefined;
  readonly onOpen: (post: ObservedPostSummary) => void;
  readonly onSave: (post: ObservedPostSummary) => void;
  readonly onAuthor: (handle: string) => void;
}) {
  return (
    // Dragged like a post on X: the row carries its status URL, so every sidebar drop takes it.
    <tr
      draggable
      tabIndex={0}
      className={cn(
        table.row,
        "cursor-pointer outline-hidden focus-visible:bg-white/[0.04]",
        "@max-[960px]:flex @max-[960px]:flex-wrap @max-[960px]:items-center @max-[960px]:gap-x-2 @max-[960px]:border-b @max-[960px]:border-border @max-[960px]:px-4 @max-[960px]:py-2",
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
          "@max-[960px]:-order-2 @max-[960px]:w-auto @max-[960px]:min-w-0 @max-[960px]:flex-1",
        )}
      >
        <div className="min-w-0 @max-[960px]:flex @max-[960px]:items-baseline @max-[960px]:gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{post.author.name}</span>
            {post.author.verified ? (
              <BadgeCheck className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </div>
          <div className="truncate font-mono text-2xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="cursor-pointer outline-hidden hover:text-foreground hover:underline focus-visible:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAuthor(post.author.handle);
                    }}
                  />
                }
              >
                @{post.author.handle}
              </TooltipTrigger>
              <TooltipPopup>{`Only posts by @${post.author.handle}`}</TooltipPopup>
            </Tooltip>
            {post.author.followers !== null ? ` · ${fmt(post.author.followers)}` : ""}
          </div>
        </div>
      </td>
      <td className={cn(table.td, stack, "@max-[960px]:w-full")}>
        <p className="line-clamp-2 max-w-2xl text-[13px] leading-snug text-foreground/90 @max-[960px]:my-1 @max-[960px]:line-clamp-4">
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
      <td className={cn(table.td, "whitespace-nowrap", stack, "@max-[960px]:-order-1")}>
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

const PAGE = 100;

/** Everything the X session has shown, newest sighting first: free, read from X's own traffic. */
export function SeenFeed({ tabs }: { readonly tabs?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<string | null>(null);
  // Where each page behind this one started; empty on the newest page.
  const [cursors, setCursors] = useState<ReadonlyArray<ObservationCursor>>([]);
  const before = cursors.at(-1);
  const page = seenPageAtom({
    limit: PAGE,
    ...(query.trim() === "" ? {} : { query }),
    ...(author === null ? {} : { authorHandle: author }),
    ...(before === undefined ? {} : { before }),
  });
  const result = useAtomValue(page);
  const refresh = useAtomRefresh(page);
  const openOnX = useOpenOnX();
  const drop = useDropPost();
  const posts = AsyncResult.getOrElse(
    AsyncResult.map(result, (value) => value.posts),
    () => null,
  );
  const hasOlder = AsyncResult.isSuccess(result) && result.value.hasOlder;
  const paged = cursors.length > 0 || hasOlder;
  const from = cursors.length * PAGE + 1;
  const marks = useMarks((posts ?? []).map((p) => ({ postId: p.postId, handle: p.author.handle })));
  const filtered = query.trim() !== "" || author !== null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Seen"
        tabs={tabs}
        detail={
          posts === null
            ? undefined
            : paged && posts.length > 0
              ? `${from}–${from + posts.length - 1}`
              : `${posts.length} posts`
        }
        actions={
          <>
            <label className="flex h-7 w-48 items-center @max-[44rem]:w-36 gap-1.5 rounded-[var(--control-radius)] border border-white/13 px-2 transition-[border-color] duration-150 focus-within:border-white/30">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground"
                aria-label="Search seen posts"
                placeholder="Search"
                maxLength={200}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursors([]);
                }}
              />
            </label>
            {author === null ? null : (
              <Button
                variant="outline"
                size="xs"
                aria-label={`Clear author @${author}`}
                onClick={() => {
                  setAuthor(null);
                  setCursors([]);
                }}
              >
                @{author}
                <X />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={refresh}>
              <RefreshCw />
            </Button>
          </>
        }
      />
      {/* Remounted per page, so an older page opens at its top. */}
      <PageBody key={cursors.length}>
        {AsyncResult.match(result, {
          onInitial: () => <Empty>Connecting to the service.</Empty>,
          onFailure: (failure) => (
            <Empty>{`Could not load observations: ${errorText(failure.cause)}`}</Empty>
          ),
          onSuccess: ({ value }) => (
            <div className="@container">
              {value.posts.length === 0 ? (
                <Empty>
                  {filtered || cursors.length > 0
                    ? "No seen post matches."
                    : isElectron
                      ? "Nothing yet. Posts you scroll past on X land here with their numbers."
                      : "Nothing yet. Browse X in the desktop app and posts land here with their numbers."}
                </Empty>
              ) : (
                <table className={cn(table.root, "@max-[960px]:block")}>
                  <thead className="@max-[960px]:hidden">
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
                  <tbody className="@max-[960px]:block">
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
                        onAuthor={(handle) => {
                          setAuthor(handle);
                          setCursors([]);
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              )}
              {paged ? (
                <div className="flex items-center justify-end gap-1 px-6 py-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={cursors.length === 0}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Newer
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!value.hasOlder}
                    onClick={() => {
                      const last = value.posts.at(-1)!;
                      setCursors([
                        ...cursors,
                        {
                          lastSeenAt: last.lastSeenAt,
                          createdAt: last.createdAt,
                          postId: last.postId,
                        },
                      ]);
                    }}
                  >
                    Older
                  </Button>
                </div>
              ) : null}
            </div>
          ),
        })}
      </PageBody>
    </div>
  );
}

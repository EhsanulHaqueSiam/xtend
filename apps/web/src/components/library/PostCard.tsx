import type { XPost } from "@xtend/contracts";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { draggedPost, POST_TYPE } from "../../lib/drag";
import { cn } from "../../lib/utils";
import { XLink } from "../ui/x-link";
import { QuickSave, RemixButton, useSavedIds } from "./SaveButton";
import { ago, erLabel, fmt, formatOf } from "./shared";

/** A post as a card in the grid: what every Library list maps its rows to. */
export interface CardItem {
  readonly key: string;
  readonly post: XPost;
  /** A word or two for the meta line: the keyword, hook, topic or saved date. */
  readonly tag?: string | null | undefined;
  /** A line under the text, such as the user's note on a saved post. */
  readonly note?: string | undefined;
}

/** The author's avatar, or their initial when X sent no picture. */
export function Avatar({
  author,
  className,
}: {
  readonly author: {
    readonly name: string;
    readonly handle: string;
    readonly avatarUrl?: string | null;
  };
  readonly className?: string;
}) {
  if (author.avatarUrl !== undefined && author.avatarUrl !== null)
    return (
      <img
        src={author.avatarUrl}
        alt=""
        loading="lazy"
        className={cn("size-[22px] shrink-0 rounded-full bg-white/7 object-cover", className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[22px] shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-semibold text-foreground/80",
        className,
      )}
    >
      {(author.name.trim() || author.handle).slice(0, 1).toUpperCase()}
    </span>
  );
}

function PostCard({
  item,
  selected,
  onSelect,
  actions,
  pick,
}: {
  readonly item: CardItem;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
  readonly actions: ReactNode;
  readonly pick:
    | { readonly picked: boolean; readonly picking: boolean; readonly onPick: () => void }
    | undefined;
}) {
  const { post } = item;
  const format = formatOf(post);
  return (
    <article
      data-selected={selected}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/uri-list", post.url);
        event.dataTransfer.setData(POST_TYPE, "");
        event.dataTransfer.effectAllowed = "copy";
        draggedPost.start(post);
      }}
      onDragEnd={draggedPost.end}
      className="group relative mb-3 break-inside-avoid rounded-[14px] border border-border bg-white/[0.02] transition-[border-color,background-color] duration-150 hover:border-white/13 hover:bg-white/[0.04] data-[selected=true]:border-white/30 data-[selected=true]:bg-white/[0.05]"
    >
      {pick === undefined ? null : (
        <input
          type="checkbox"
          aria-label={`Select the post by @${post.author.handle}`}
          checked={pick.picked}
          onChange={pick.onPick}
          className={cn(
            "absolute top-3.5 right-3.5 size-3.5 cursor-pointer accent-foreground transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100",
            !pick.picking && "[@media(hover:hover)]:opacity-0",
          )}
        />
      )}
      <button
        type="button"
        aria-pressed={selected}
        className="block w-full cursor-pointer rounded-t-[14px] px-3.5 pt-3.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => onSelect(item.key)}
      >
        <p
          className={cn(
            "line-clamp-12 text-[13.5px] leading-normal break-words whitespace-pre-line text-foreground",
            pick !== undefined && "pr-5",
          )}
        >
          {post.text}
        </p>
        {item.note !== undefined && item.note !== "" ? (
          <p className="mt-2 line-clamp-2 border-l border-white/13 pl-2 text-xs text-muted-foreground">
            {item.note}
          </p>
        ) : null}
        <p className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span>{fmt(post.metrics.views)} views</span>
          <span>{erLabel(post.metrics)} ER</span>
          <span>{ago(post.createdAt)}</span>
          {format === "text" ? null : <span>{format}</span>}
          {item.tag !== undefined && item.tag !== null ? <span>{item.tag}</span> : null}
        </p>
      </button>
      {/* Fixed height, so the hover actions never move the cards under it. */}
      <div className="mx-3.5 mt-2.5 mb-3 flex h-7 items-center gap-2">
        <Avatar author={post.author} />
        <span className="min-w-0 truncate text-xs text-foreground/80">@{post.author.handle}</span>
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 group-focus-within:flex group-hover:flex">
          {actions}
        </span>
        <XLink
          href={post.url}
          label="Open on X"
          className="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-white/7 text-foreground/80 transition-colors duration-150 group-focus-within:ml-0 group-hover:ml-0 hover:bg-white/13 hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </XLink>
      </div>
    </article>
  );
}

/**
 * Posts as a masonry of cards, as many columns as fit. A click selects a card
 * for the detail column; the footer's actions show on hover or focus, the
 * arrow opens the post on X.
 */
export function PostGrid({
  items,
  selected,
  onSelect,
  actions,
  picked,
  onPick,
  className,
}: {
  readonly items: ReadonlyArray<CardItem>;
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  /** The footer's hover actions; Remix and Save by default. */
  readonly actions?: (item: CardItem) => ReactNode;
  /** Cards checked for a bulk action; with `onPick`, every card gets a checkbox. */
  readonly picked?: ReadonlySet<string>;
  readonly onPick?: (key: string) => void;
  readonly className?: string;
}) {
  const saved = useSavedIds();
  const grid = useRef<HTMLDivElement>(null);
  // The open card, so closing its inspector can hand focus back: at panel width the column
  // covers the grid, and closing it leaves focus nowhere.
  const open = useRef<{ readonly key: string; readonly index: number } | null>(null);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- hands DOM focus back to the card whose inspector closed, when the close left focus on body.
  useEffect(() => {
    const closed = open.current;
    const index = items.findIndex((i) => i.key === selected);
    open.current = selected === null || index === -1 ? null : { key: selected, index };
    // Only a close that dropped focus: never pull it from wherever the user moved it.
    if (selected !== null || closed === null || document.activeElement !== document.body) return;
    const at = items.findIndex((i) => i.key === closed.key);
    const cards = grid.current?.querySelectorAll<HTMLElement>(":scope > article > button");
    // Removed along with its inspector: the card that took its place.
    cards?.[at === -1 ? Math.min(closed.index, items.length - 1) : at]?.focus();
  });
  return (
    <div ref={grid} className={cn("columns-[15rem] gap-3 px-6 py-5", className)}>
      {items.map((item) => (
        <PostCard
          key={item.key}
          item={item}
          selected={item.key === selected}
          onSelect={onSelect}
          pick={
            onPick === undefined
              ? undefined
              : {
                  picked: picked?.has(item.key) ?? false,
                  picking: (picked?.size ?? 0) > 0,
                  onPick: () => onPick(item.key),
                }
          }
          actions={
            actions === undefined ? (
              <>
                <RemixButton post={item.post} />
                <QuickSave post={item.post} saved={saved.has(item.post.postId)} />
              </>
            ) : (
              actions(item)
            )
          }
        />
      ))}
    </div>
  );
}

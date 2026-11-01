import type { XPost } from "@xtend/contracts";
import { ArrowUpRight, BadgeCheck, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Props } from "../ui/split";
import { XLink } from "../ui/x-link";
import { xIconButton } from "../x";
import { Avatar } from "./PostCard";
import { ago, erLabel, fmt, formatOf } from "./shared";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const NO_FACTS: ReadonlyArray<readonly [string, string]> = [];

/** The detail column's groups: a small label and the content, no card. */
export function InspectorGroup({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="px-5 pt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-foreground/80">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The selected post in the grid's detail column (`DetailSplit`, closable):
 * author, the full text, the section's own groups (`children`), then every
 * number. Escape or the cross closes it. It opens with focus on the cross;
 * `PostGrid` hands focus back to the card on close.
 */
export function PostInspector({
  post,
  format = formatOf(post),
  facts = NO_FACTS,
  onClose,
  children,
}: {
  readonly post: XPost;
  /** The archive's label when it has one; it alone knows threads. */
  readonly format?: string;
  /** Extra rows for the numbers table, such as the keyword or hook. */
  readonly facts?: ReadonlyArray<readonly [string, string]>;
  readonly onClose: () => void;
  readonly children?: ReactNode;
}) {
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- window Escape listener that closes the inspector while it is mounted.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A menu that handled the key (the Save menu) keeps the column open.
      if (event.key === "Escape" && !event.defaultPrevented && !isEditable(event.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const m = post.metrics;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["Views", fmt(m.views)],
    ["Likes", fmt(m.likes)],
    ["Reposts", fmt(m.reposts)],
    ["Replies", fmt(m.replies)],
    ["Quotes", fmt(m.quotes)],
    ["Bookmarks", fmt(m.bookmarks)],
    ["Engagement", erLabel(m)],
    ["Posted", `${ago(post.createdAt)} ago`],
    ["Format", format],
    ...facts,
  ];
  return (
    <div className="pb-6">
      <div className="flex items-start gap-2.5 px-5 pt-4">
        <Avatar author={post.author} className="mt-0.5 size-7" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-[13.5px] font-semibold">
            <span className="truncate">{post.author.name}</span>
            {post.author.verified ? (
              <BadgeCheck className="size-3.5 shrink-0 text-foreground/70" />
            ) : null}
          </div>
          <div className="truncate font-mono text-2xs text-muted-foreground tabular-nums">
            @{post.author.handle}
            {post.author.followers === null ? "" : ` · ${fmt(post.author.followers)} followers`}
          </div>
        </div>
        <XLink href={post.url} label="Open on X" className={cn(xIconButton, "size-7")}>
          <ArrowUpRight />
        </XLink>
        {/* At panel width the column covers the grid, and the clicked card's focus with it. */}
        <button
          type="button"
          aria-label="Close"
          autoFocus
          className={cn(xIconButton, "size-7")}
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <p className="px-5 pt-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap">
        {post.text}
      </p>
      {children}
      <InspectorGroup title="Numbers">
        <Props rows={rows} />
      </InspectorGroup>
    </div>
  );
}

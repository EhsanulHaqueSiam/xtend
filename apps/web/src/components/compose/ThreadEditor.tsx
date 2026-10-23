import {
  type DraftBlock,
  type DraftMedia,
  hasLink,
  LINK_PATTERN,
  MEDIA_MAX_IMAGES,
  type ReplySettings,
} from "@xtend/contracts";
import { ArrowDown, ArrowUp, Film, Image, Plus, X } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

const POST_LIMIT = 280;
export const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

// The contract's link rule, so the counter and the price agree with what the service charges.
const LINK = new RegExp(LINK_PATTERN.source, "gi");

/** X counts every link as 23 characters whatever its length. shortcut: CJK and emoji weights ignored, add when a user hits it. */
export const charCount = (text: string) => [...text.replace(LINK, "x".repeat(23))].length;

/** Plain text pasted with blank lines between posts becomes one block per paragraph. */
export const splitBlocks = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== "");

const move = <A,>(list: ReadonlyArray<A>, from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

export const REPLY_OPTIONS: ReadonlyArray<readonly [ReplySettings, string]> = [
  ["everyone", "Everyone"],
  ["following", "Accounts you follow"],
  ["mentionedUsers", "Only mentioned"],
  ["verified", "Verified"],
];

const fileName = (path: string) => path.split("/").pop() ?? path;

/** Positions follow list order; blocks of later posts shift by `delta` after `from`. */
const renumber = (media: ReadonlyArray<DraftMedia>) => {
  const out: Array<DraftMedia> = [];
  for (const [position, m] of media.entries()) out.push({ ...m, position });
  return out;
};
const shiftBlocks = (media: ReadonlyArray<DraftMedia>, after: number, delta: number) => {
  const out: Array<DraftMedia> = [];
  for (const m of media)
    out.push(m.blockIndex > after ? { ...m, blockIndex: m.blockIndex + delta } : m);
  return out;
};

/** The attachments of one block: thumbnail when the file was just picked, alt text, drag to reorder. */
export function MediaList({
  media,
  previews,
  onChange,
  onRemove,
}: {
  readonly media: ReadonlyArray<DraftMedia>;
  /** Object URLs for files added this session; stored files show their name instead. */
  readonly previews: Readonly<Record<string, string>>;
  readonly onChange: (media: ReadonlyArray<DraftMedia>) => void;
  readonly onRemove: (id: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const drop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (dragging === null || dragging === targetId) return;
    const from = media.findIndex((m) => m.id === dragging);
    const to = media.findIndex((m) => m.id === targetId);
    onChange(renumber(move(media, from, to)));
    setDragging(null);
  };
  if (media.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-2 pb-1.5" aria-label="Attached media">
      {media.map((m) => (
        <li
          key={m.id}
          draggable
          onDragStart={() => setDragging(m.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, m.id)}
          className={cn(
            "flex w-36 cursor-grab flex-col gap-1 rounded-md border border-border bg-background p-1",
            dragging === m.id && "opacity-50",
          )}
        >
          <div className="flex h-16 items-center justify-center overflow-hidden rounded-sm bg-muted">
            {previews[m.id] !== undefined && m.kind === "image" ? (
              <img src={previews[m.id]} alt={m.alt} className="h-full w-full object-cover" />
            ) : (
              <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                {m.kind === "video" ? <Film className="size-3" /> : <Image className="size-3" />}
                <span className="max-w-24 truncate">{fileName(m.path)}</span>
              </span>
            )}
          </div>
          {m.kind === "image" ? (
            <input
              className={inputClass + " px-1.5 py-0.5"}
              aria-label="Alt text"
              placeholder="Alt text"
              value={m.alt}
              onChange={(e) =>
                onChange(media.map((x) => (x.id === m.id ? { ...x, alt: e.target.value } : x)))
              }
            />
          ) : null}
          <Button
            variant="ghost-muted"
            size="xs"
            aria-label="Remove media"
            onClick={() => onRemove(m.id)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ThreadEditor({
  blocks,
  media,
  previews,
  active,
  onChange,
  onFocus,
  onAddFiles,
  onMediaChange,
  onRemoveMedia,
}: {
  readonly blocks: ReadonlyArray<DraftBlock>;
  readonly media: ReadonlyArray<DraftMedia>;
  readonly previews: Readonly<Record<string, string>>;
  readonly active: number;
  readonly onChange: (blocks: ReadonlyArray<DraftBlock>) => void;
  readonly onFocus: (index: number) => void;
  readonly onAddFiles: (index: number, files: ReadonlyArray<File>) => void;
  readonly onMediaChange: (media: ReadonlyArray<DraftMedia>) => void;
  readonly onRemoveMedia: (id: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef(0);
  const set = (i: number, text: string) =>
    onChange(blocks.map((b, j) => (j === i ? { ...b, text } : b)));
  const paste = (i: number, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pieces = splitBlocks(e.clipboardData.getData("text/plain"));
    if (pieces.length < 2) return;
    e.preventDefault();
    onChange([...blocks.slice(0, i), ...pieces.map((text) => ({ text })), ...blocks.slice(i + 1)]);
  };
  // Media rows point at a block index, so moving a block moves its attachments with it.
  const moveBlock = (from: number, to: number) => {
    onChange(move(blocks, from, to));
    const order = move(
      blocks.map((_, i) => i),
      from,
      to,
    );
    onMediaChange(media.map((m) => ({ ...m, blockIndex: order.indexOf(m.blockIndex) })));
  };
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        accept="image/*,video/mp4,video/quicktime"
        onChange={(e) => {
          onAddFiles(pickFor.current, [...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {blocks.map(({ text, replySettings }, i) => {
        const count = charCount(text);
        const over = count > POST_LIMIT;
        const here = media.filter((m) => m.blockIndex === i);
        const full = here.some((m) => m.kind === "video") || here.length >= MEDIA_MAX_IMAGES;
        return (
          <div
            // Blocks are plain strings; their position is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className={cn("rounded-md border border-border bg-card", i === active && "border-ring")}
          >
            <textarea
              aria-label={`Post ${i + 1}`}
              className="w-full resize-none bg-transparent px-3 pt-2.5 text-sm leading-relaxed outline-hidden placeholder:text-placeholder"
              rows={Math.max(2, Math.ceil(count / 60))}
              placeholder={i === 0 ? "Start with the hook" : "Next post"}
              value={text}
              onFocus={() => onFocus(i)}
              onChange={(e) => set(i, e.target.value)}
              onPaste={(e) => paste(i, e)}
            />
            <MediaList
              media={here}
              previews={previews}
              onChange={(next) =>
                onMediaChange([...media.filter((m) => m.blockIndex !== i), ...next])
              }
              onRemove={onRemoveMedia}
            />
            <div className="flex items-center gap-0.5 px-2 pb-1.5">
              <span
                className={cn(
                  "font-mono text-2xs",
                  over ? "text-error-foreground" : "text-muted-foreground",
                )}
              >
                {count}/{POST_LIMIT}
                {hasLink(text) ? " · link" : ""}
              </span>
              <select
                aria-label={`Who can reply to post ${i + 1}`}
                className="ml-2 mr-auto rounded-md border border-input bg-background px-1 py-0.5 text-2xs text-muted-foreground"
                value={replySettings ?? ""}
                onChange={(e) =>
                  onChange(
                    blocks.map((b, j) =>
                      j === i
                        ? e.target.value === ""
                          ? { text: b.text }
                          : { ...b, replySettings: e.target.value as ReplySettings }
                        : b,
                    ),
                  )
                }
              >
                <option value="">Reply: draft default</option>
                {REPLY_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    Reply: {label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Add media"
                disabled={full}
                onClick={() => {
                  pickFor.current = i;
                  picker.current?.click();
                }}
              >
                <Image />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => moveBlock(i, i - 1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Move down"
                disabled={i === blocks.length - 1}
                onClick={() => moveBlock(i, i + 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Add post below"
                onClick={() => {
                  onChange([...blocks.slice(0, i + 1), { text: "" }, ...blocks.slice(i + 1)]);
                  onMediaChange(shiftBlocks(media, i, 1));
                }}
              >
                <Plus />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Remove post"
                disabled={blocks.length === 1}
                onClick={() => {
                  for (const m of here) onRemoveMedia(m.id);
                  onChange(blocks.filter((_, j) => j !== i));
                  onMediaChange(
                    shiftBlocks(
                      media.filter((m) => m.blockIndex !== i),
                      i,
                      -1,
                    ),
                  );
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import {
  type DraftBlock,
  type DraftMedia,
  hasLink,
  LINK_PATTERN,
  MEDIA_MAX_IMAGES,
  type ReplySettings,
} from "@xtend/contracts";
import { ArrowDown, ArrowUp, Film, Globe, Image, Plus, X } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { xIconButton } from "../x";

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

/** X's character ring: fills blue, turns yellow in the last 20 and red past the limit. */
function CountRing({ count }: { readonly count: number }) {
  const radius = 9;
  const length = 2 * Math.PI * radius;
  const left = POST_LIMIT - count;
  const color = left < 0 ? "#f4212e" : left <= 20 ? "#ffd400" : "#1d9bf0";
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 22 22" className="size-5" aria-hidden="true">
        <circle cx="11" cy="11" r={radius} fill="none" stroke="var(--border)" strokeWidth="2" />
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={`${length * Math.min(count / POST_LIMIT, 1)} ${length}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span
        className={cn(
          "text-[13px] tabular-nums",
          left < 0 ? "text-[#f4212e]" : "text-muted-foreground",
        )}
        aria-label="Characters left"
      >
        {left}
      </span>
    </span>
  );
}

/**
 * X's thread composer: one row per post with the avatar and the connector line, the post being
 * written in X's 20px type with its tools, the others quieter until clicked.
 */
export function ThreadEditor({
  blocks,
  media,
  previews,
  active,
  avatar,
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
  /** The account's initials in the avatar circle. */
  readonly avatar: string;
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
  const insertAfter = (i: number) => {
    onChange([...blocks.slice(0, i + 1), { text: "" }, ...blocks.slice(i + 1)]);
    onMediaChange(shiftBlocks(media, i, 1));
    onFocus(i + 1);
  };
  return (
    <div className="flex flex-col">
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
        const on = i === active;
        const here = media.filter((m) => m.blockIndex === i);
        const full = here.some((m) => m.kind === "video") || here.length >= MEDIA_MAX_IMAGES;
        return (
          <div
            // Blocks are plain strings; their position is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className={cn(
              "flex gap-3 px-4 pt-3 transition-opacity duration-150",
              !on && "opacity-60 hover:opacity-90",
            )}
          >
            <div className="flex flex-col items-center">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#333639] text-sm font-bold text-foreground">
                {avatar}
              </div>
              {i < blocks.length - 1 ? <div className="mt-1 w-0.5 flex-1 bg-[#333639]" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <textarea
                aria-label={`Post ${i + 1}`}
                className={cn(
                  "w-full resize-none bg-transparent text-foreground outline-hidden placeholder:text-placeholder",
                  on ? "pt-1.5 text-xl leading-6" : "pt-2 text-[15px] leading-5",
                )}
                rows={Math.max(on ? 2 : 1, Math.ceil(count / (on ? 45 : 60)))}
                placeholder={i === 0 ? "What's happening?" : "Add another post"}
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
              {on ? (
                <>
                  <label className="-ml-2 mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-sm font-bold text-primary hover:bg-primary/10">
                    <Globe className="size-4" />
                    <select
                      aria-label={`Who can reply to post ${i + 1}`}
                      className="cursor-pointer appearance-none bg-transparent outline-hidden"
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
                      <option value="">Draft default can reply</option>
                      {REPLY_OPTIONS.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label} can reply
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="-ml-2 mt-2 flex items-center border-t border-border pt-2">
                    <button
                      type="button"
                      className={xIconButton}
                      aria-label="Add media"
                      disabled={full}
                      onClick={() => {
                        pickFor.current = i;
                        picker.current?.click();
                      }}
                    >
                      <Image />
                    </button>
                    {/* Order and removal only mean something once there is a thread. */}
                    {blocks.length > 1 ? (
                      <>
                        <button
                          type="button"
                          className={xIconButton}
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => moveBlock(i, i - 1)}
                        >
                          <ArrowUp />
                        </button>
                        <button
                          type="button"
                          className={xIconButton}
                          aria-label="Move down"
                          disabled={i === blocks.length - 1}
                          onClick={() => moveBlock(i, i + 1)}
                        >
                          <ArrowDown />
                        </button>
                        <button
                          type="button"
                          className={xIconButton}
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
                        </button>
                      </>
                    ) : null}
                    <span className="flex-1" />
                    {hasLink(text) ? (
                      <span className="mr-3 text-[13px] text-muted-foreground">link</span>
                    ) : null}
                    <CountRing count={count} />
                    <span className="mx-3 h-7 w-px bg-border" />
                    <button
                      type="button"
                      className={cn(xIconButton, "size-7 border border-border [&_svg]:size-4")}
                      aria-label="Add post below"
                      onClick={() => insertAfter(i)}
                    >
                      <Plus />
                    </button>
                  </div>
                </>
              ) : count > POST_LIMIT ? (
                <p className="mt-1 text-[13px] text-[#f4212e]">{POST_LIMIT - count} characters</p>
              ) : null}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-3 px-4 pt-1 pb-3 text-left text-[15px] text-muted-foreground hover:text-foreground"
        onClick={() => insertAfter(blocks.length - 1)}
      >
        <span className="flex w-10 justify-center">
          <span className="flex size-6 items-center justify-center rounded-full border border-[#333639]">
            <Plus className="size-3.5" />
          </span>
        </span>
        Add another post
      </button>
    </div>
  );
}

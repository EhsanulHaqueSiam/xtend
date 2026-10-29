import {
  type DraftBlock,
  type DraftMedia,
  LINK_PATTERN,
  MEDIA_MAX_IMAGES,
  type ReplySettings,
} from "@xtend/contracts";
import { ArrowDown, ArrowUp, Film, Globe, Image, Plus, X } from "lucide-react";
import type { ClipboardEvent, DragEvent, ReactNode } from "react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { compactInputClass } from "../ui/field";
import { Select } from "../ui/select";

const POST_LIMIT = 280;

// The contract's link rule, so the counter and the price agree with what the service charges.
const LINK = new RegExp(LINK_PATTERN.source, "gi");

// X's weighting (twitter-text v3): code points in these ranges count 1, every other one 2
// (CJK, most symbols), an emoji sequence 2 however many code points it joins, a link 23.
const LIGHT: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const EMOJI = /\p{Emoji_Presentation}|️|\p{Regional_Indicator}|⃣/u;
const graphemes = new Intl.Segmenter();

/** The length X checks against 280. */
export const charCount = (text: string) => {
  let count = 0;
  for (const { segment } of graphemes.segment(
    text.normalize("NFC").replace(LINK, "x".repeat(23)),
  )) {
    if (EMOJI.test(segment)) count += 2;
    else
      for (const ch of segment) {
        const cp = ch.codePointAt(0) ?? 0;
        count += LIGHT.some(([from, to]) => cp >= from && cp <= to) ? 1 : 2;
      }
  }
  return count;
};

/** The text X receives for post i; the service appends the quote link to the first post. */
export const postText = (text: string, i: number, quoteUrl: string | null) =>
  i === 0 && quoteUrl !== null ? `${text}\n${quoteUrl}` : text;

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
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached media">
      {media.map((m) => (
        <li
          key={m.id}
          draggable
          onDragStart={() => setDragging(m.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, m.id)}
          className={cn(
            "flex w-40 cursor-grab flex-col gap-1.5 rounded-[var(--control-radius)] border border-white/13 p-1.5",
            dragging === m.id && "opacity-50",
          )}
        >
          <div className="flex h-20 items-center justify-center overflow-hidden rounded-md bg-surface-raised">
            {previews[m.id] !== undefined && m.kind === "image" ? (
              <img src={previews[m.id]} alt={m.alt} className="h-full w-full object-cover" />
            ) : (
              <span className="flex items-center gap-1 font-mono text-2xs text-muted-foreground">
                {m.kind === "video" ? <Film className="size-3" /> : <Image className="size-3" />}
                <span className="max-w-28 truncate">{fileName(m.path)}</span>
              </span>
            )}
          </div>
          {m.kind === "image" ? (
            <input
              className={compactInputClass}
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

/** "41/280" in mono: amber in the last 20, red past the limit. */
function Count({ count }: { readonly count: number }) {
  const left = POST_LIMIT - count;
  return (
    <span
      aria-label="Characters used"
      className={cn(
        "font-mono text-2xs tabular-nums",
        left < 0
          ? "text-error-foreground"
          : left <= 20
            ? "text-warning-foreground"
            : "text-muted-foreground/70",
      )}
    >
      {count}/{POST_LIMIT}
    </span>
  );
}

const tool =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/**
 * The thread being written: one post per row on a hairline rail, a mono count under each.
 * The post being written shows its tools (media, who can reply, order, remove, add below).
 */
export function ThreadEditor({
  blocks,
  media,
  previews,
  quoteUrl,
  active,
  avatar,
  notes,
  onChange,
  onFocus,
  onAddFiles,
  onMediaChange,
  onRemoveMedia,
}: {
  readonly blocks: ReadonlyArray<DraftBlock>;
  readonly media: ReadonlyArray<DraftMedia>;
  readonly previews: Readonly<Record<string, string>>;
  /** Rides on the first post, so it counts against that post's 280. */
  readonly quoteUrl: string | null;
  readonly active: number;
  /** The account's initial in the avatar circle. */
  readonly avatar: string;
  /** A short fact beside each post's count, such as a link post's price. */
  readonly notes?: ReadonlyArray<ReactNode>;
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
    // The post's own text stays around the pasted posts, split at the caret.
    const { value, selectionStart, selectionEnd } = e.currentTarget;
    const texts = pieces.map((p, j) =>
      j === 0
        ? value.slice(0, selectionStart) + p
        : j === pieces.length - 1
          ? p + value.slice(selectionEnd)
          : p,
    );
    onChange([
      ...blocks.slice(0, i),
      { ...blocks[i], text: texts[0] ?? "" },
      ...texts.slice(1).map((text) => ({ text })),
      ...blocks.slice(i + 1),
    ]);
    onMediaChange(shiftBlocks(media, i, pieces.length - 1));
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
        const count = charCount(postText(text, i, quoteUrl));
        const on = i === active;
        const here = media.filter((m) => m.blockIndex === i);
        const full = here.some((m) => m.kind === "video") || here.length >= MEDIA_MAX_IMAGES;
        return (
          <div
            // Blocks are plain strings; their position is their identity.
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            className="relative flex gap-3 pb-4"
          >
            {i < blocks.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-9 bottom-1 left-[14.5px] w-px bg-white/13"
              />
            ) : null}
            <div className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-foreground">
              {avatar}
            </div>
            <div className="min-w-0 flex-1">
              <textarea
                aria-label={`Post ${i + 1}`}
                className={cn(
                  "block w-full resize-none bg-transparent pt-1 text-[15px] leading-normal text-foreground outline-hidden field-sizing-content placeholder:text-placeholder",
                  blocks.length === 1 ? "min-h-[3lh]" : "min-h-[1lh]",
                )}
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
              <div className="mt-1 flex h-7 items-center gap-0.5">
                {on ? (
                  <>
                    <button
                      type="button"
                      className={cn(tool, "-ml-1.5")}
                      aria-label="Add media"
                      disabled={full}
                      onClick={() => {
                        pickFor.current = i;
                        picker.current?.click();
                      }}
                    >
                      <Image />
                    </button>
                    <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground">
                      <Globe className="size-3.5" />
                      <Select
                        compact
                        label={`Who can reply to post ${i + 1}`}
                        className="border-transparent text-muted-foreground hover:text-foreground"
                        value={replySettings}
                        onChange={(next) =>
                          onChange(
                            blocks.map((b, j) =>
                              j === i
                                ? next === undefined
                                  ? { text: b.text }
                                  : { ...b, replySettings: next }
                                : b,
                            ),
                          )
                        }
                        options={[
                          { value: undefined, label: "Default replies" },
                          ...REPLY_OPTIONS.map(([v, label]) => ({
                            value: v,
                            label: `${label} can reply`,
                          })),
                        ]}
                      />
                    </label>
                    {/* Order and removal only mean something once there is a thread. */}
                    {blocks.length > 1 ? (
                      <>
                        <button
                          type="button"
                          className={tool}
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => moveBlock(i, i - 1)}
                        >
                          <ArrowUp />
                        </button>
                        <button
                          type="button"
                          className={tool}
                          aria-label="Move down"
                          disabled={i === blocks.length - 1}
                          onClick={() => moveBlock(i, i + 1)}
                        >
                          <ArrowDown />
                        </button>
                        <button
                          type="button"
                          className={tool}
                          aria-label="Remove post"
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
                    <button
                      type="button"
                      className={tool}
                      aria-label="Add post below"
                      onClick={() => insertAfter(i)}
                    >
                      <Plus />
                    </button>
                  </>
                ) : null}
                <span className="flex-1" />
                {notes?.[i] !== undefined && notes[i] !== null ? (
                  <span className="mr-3 flex items-baseline gap-1.5 text-2xs text-muted-foreground">
                    {notes[i]}
                  </span>
                ) : null}
                <Count count={count} />
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="-ml-1 flex h-8 w-fit cursor-pointer items-center gap-2.5 rounded-md pr-2 pl-[11px] text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={() => insertAfter(blocks.length - 1)}
      >
        <Plus className="size-3.5" />
        Add post
      </button>
    </div>
  );
}

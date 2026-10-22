import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ClipboardEvent } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export const POST_LIMIT = 280;
export const inputClass =
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

// Same rule XClient.postCostUsd uses, so the cost line matches what the service will charge.
const LINK = /https?:\/\/\S+|\b[a-z0-9-]+\.[a-z]{2,}\b/gi;
export const hasLink = (text: string) => new RegExp(LINK.source, "i").test(text);
export const postCostUsd = (text: string) => (hasLink(text) ? 0.2 : 0.015);

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

export function ThreadEditor({
  blocks,
  active,
  onChange,
  onFocus,
}: {
  readonly blocks: ReadonlyArray<string>;
  readonly active: number;
  readonly onChange: (blocks: ReadonlyArray<string>) => void;
  readonly onFocus: (index: number) => void;
}) {
  const set = (i: number, text: string) => onChange(blocks.map((b, j) => (j === i ? text : b)));
  const paste = (i: number, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pieces = splitBlocks(e.clipboardData.getData("text/plain"));
    if (pieces.length < 2) return;
    e.preventDefault();
    onChange([...blocks.slice(0, i), ...pieces, ...blocks.slice(i + 1)]);
  };
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((text, i) => {
        const count = charCount(text);
        const over = count > POST_LIMIT;
        return (
          <div
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
            <div className="flex items-center gap-0.5 px-2 pb-1.5">
              <span
                className={cn(
                  "mr-auto font-mono text-2xs",
                  over ? "text-error-foreground" : "text-muted-foreground",
                )}
              >
                {count}/{POST_LIMIT}
                {hasLink(text) ? " · link" : ""}
              </span>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => onChange(move(blocks, i, i - 1))}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Move down"
                disabled={i === blocks.length - 1}
                onClick={() => onChange(move(blocks, i, i + 1))}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Add post below"
                onClick={() => onChange([...blocks.slice(0, i + 1), "", ...blocks.slice(i + 1)])}
              >
                <Plus />
              </Button>
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Remove post"
                disabled={blocks.length === 1}
                onClick={() => onChange(blocks.filter((_, j) => j !== i))}
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

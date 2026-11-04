import {
  type ArticleBlock,
  embeddedPostId,
  type InlineStyle,
  type InlineText,
  inlineToHtml,
  isTextBlock,
  readInline,
  sliceInline,
  writeInline,
} from "@xtend/contracts";
import { X } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef } from "react";

import { cn } from "../../lib/utils";

export type TextBlock = Extract<ArticleBlock, { readonly kind: TextKind }>;
export type TextKind = "body" | "heading" | "subheading" | "quote" | "bullet" | "number";

/** X's editor's look per text style, as its reader draws it. */
const LOOK: Readonly<Record<TextKind, string>> = {
  body: "text-[17px] leading-7",
  heading: "text-[26px] leading-8 font-extrabold",
  subheading: "text-[22px] leading-7 font-bold",
  quote: "border-l-2 border-white/40 pl-4 text-[17px] leading-7 italic",
  bullet: "text-[17px] leading-7",
  number: "text-[17px] leading-7",
};

/** X's In-Text Shortcuts: typed at the start of a block, then a space (bundle.TwitterArticles). */
const SHORTCUTS: ReadonlyArray<readonly [RegExp, TextKind]> = [
  [/^## /, "subheading"],
  [/^# /, "heading"],
  [/^[-+*] /, "bullet"],
  [/^\d+[.)] /, "number"],
  [/^>>? /, "quote"],
];

/** X's ⌘⇧. and ⌘⇧, step through its text sizes. */
const SIZES: ReadonlyArray<TextKind> = ["body", "subheading", "heading"];
const resized = (kind: TextKind, by: 1 | -1): TextKind =>
  SIZES[Math.min(Math.max(SIZES.indexOf(kind) + by, 0), SIZES.length - 1)] ?? kind;

const STYLE_TAGS: Readonly<Record<string, InlineStyle>> = {
  B: "Bold",
  STRONG: "Bold",
  I: "Italic",
  EM: "Italic",
  S: "Strikethrough",
  DEL: "Strikethrough",
  STRIKE: "Strikethrough",
};

/** What a block's DOM shows: its text, and the styles and links its elements give it. */
function readDom(root: Node): InlineText {
  let text = "";
  let at = 0;
  const styles: Array<InlineText["styles"][number]> = [];
  const links: Array<InlineText["links"][number]> = [];
  const walk = (node: Node, on: ReadonlySet<InlineStyle>, link: string | null) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const piece = (node.textContent ?? "").replaceAll("\n", " ");
      const n = [...piece].length;
      if (n === 0) return;
      for (const style of on) styles.push({ offset: at, length: n, style });
      if (link !== null) links.push({ offset: at, length: n, url: link });
      text += piece;
      at += n;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const style = STYLE_TAGS[node.tagName];
    const href = node.tagName === "A" ? node.getAttribute("href") : null;
    const next = style === undefined ? on : new Set([...on, style]);
    for (const child of node.childNodes)
      walk(child, next, href !== null && /^https?:\/\//.test(href) ? href : link);
  };
  for (const child of root.childNodes) walk(child, new Set(), null);
  // Through Markdown and back, so runs a browser split into pieces are one range again.
  return readInline(writeInline({ text, styles, links }));
}

/** The selection inside `el` as code-point offsets of its text, or null when it is elsewhere. */
export function selectionIn(
  el: HTMLElement,
): { readonly start: number; readonly end: number } | null {
  const sel = getSelection();
  if (
    sel === null ||
    sel.rangeCount === 0 ||
    !el.contains(sel.anchorNode) ||
    !el.contains(sel.focusNode)
  )
    return null;
  const offset = (node: Node, at: number) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, at);
    return [...r.toString()].length;
  };
  const a = offset(sel.anchorNode!, sel.anchorOffset);
  const b = offset(sel.focusNode!, sel.focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Puts the caret `offset` code points into `el`'s text. */
function placeCaret(el: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = offset;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const chars = [...(node.textContent ?? "")];
    if (left <= chars.length) {
      range.setStart(node, chars.slice(0, left).join("").length);
      range.collapse(true);
      break;
    }
    left -= chars.length;
  }
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export interface TextHandlers {
  readonly onChange: (text: string) => void;
  readonly onKind: (kind: TextKind, text: string) => void;
  /** Enter: the text before the caret stays, the text after starts a new block. */
  readonly onSplit: (before: string, after: string) => void;
  /** Backspace at the very start: this block joins the one above. */
  readonly onJoin: (text: string) => void;
  /** ⌘K: X's Insert link, on the selection. */
  readonly onLink: () => void;
  readonly onFocus: () => void;
}

/**
 * One text block, edited where it shows, as X's editor does: its styles drawn, X's shortcuts
 * typed or pressed. The DOM is the block's while it is focused; it is drawn again from the draft
 * only when the draft changed from elsewhere (an assist Use, a style picked).
 */
function RichText({
  block,
  index,
  marker,
  focus,
  onFocused,
  handlers,
}: {
  readonly block: TextBlock;
  readonly index: number;
  /** A list item's bullet or number. */
  readonly marker: string | null;
  /** Where to put the caret once drawn, or null to leave it. */
  readonly focus: number | null;
  readonly onFocused: () => void;
  readonly handlers: TextHandlers;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- draws the block's Markdown into its editable DOM when the draft changed from outside it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || shown.current === block.text) return;
    // inlineToHtml escapes the text and keeps only http(s) links.
    el.innerHTML = inlineToHtml(block.text);
    shown.current = block.text;
  }, [block.text]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the browser's caret where the editor asked (a split, a join, an insert).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || focus === null) return;
    el.focus();
    placeCaret(el, focus);
    onFocused();
  }, [focus, onFocused]);

  const read = () => {
    const md = writeInline(readDom(ref.current!));
    shown.current = md;
    return md;
  };
  const onInput = () => {
    const md = read();
    const shortcut = block.kind === "body" ? SHORTCUTS.find(([re]) => re.test(md)) : undefined;
    if (shortcut !== undefined) handlers.onKind(shortcut[1], md.replace(shortcut[0], ""));
    else handlers.onChange(md);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current!;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const inline = readDom(el);
      const at = selectionIn(el)?.start ?? [...inline.text].length;
      return handlers.onSplit(
        writeInline(sliceInline(inline, 0, at)),
        writeInline(sliceInline(inline, at)),
      );
    }
    const sel = selectionIn(el);
    if (e.key === "Backspace" && sel !== null && sel.start === 0 && sel.end === 0) {
      e.preventDefault();
      // As in X: a styled block turns back into Body first, then joins the one above.
      return block.kind === "body" ? handlers.onJoin(read()) : handlers.onKind("body", read());
    }
    if (!mod) return;
    const key = e.key.toLowerCase();
    const command =
      !e.shiftKey && key === "b"
        ? "bold"
        : !e.shiftKey && key === "i"
          ? "italic"
          : e.shiftKey && key === "x"
            ? "strikeThrough"
            : null;
    if (command !== null) {
      e.preventDefault();
      document.execCommand(command);
      return;
    }
    if (!e.shiftKey && key === "k") {
      e.preventDefault();
      return handlers.onLink();
    }
    const kind = e.shiftKey
      ? ({ Digit7: "bullet", Digit8: "number", Digit9: "quote" } as const)[e.code as "Digit7"]
      : undefined;
    const size = e.shiftKey ? ({ Period: 1, Comma: -1 } as const)[e.code as "Period"] : undefined;
    if (kind !== undefined || size !== undefined) {
      e.preventDefault();
      const next = kind ?? resized(block.kind, size!);
      handlers.onKind(next === block.kind ? "body" : next, read());
    }
  };
  return (
    <div className={cn(marker !== null && "flex gap-2 pl-2")}>
      {marker === null ? null : (
        <span aria-hidden="true" className="min-w-4 text-right text-[17px] leading-7">
          {marker}
        </span>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="false"
        aria-label={index === 0 ? "Article body" : `Block ${index + 1}`}
        contentEditable
        suppressContentEditableWarning
        data-block={index}
        data-kind={block.kind}
        data-placeholder={index === 0 ? "Start writing" : ""}
        className={cn(
          "min-h-7 min-w-0 flex-1 break-words whitespace-pre-wrap outline-hidden empty:before:text-[#71767b] empty:before:content-[attr(data-placeholder)] [&_a]:text-[#1d9bf0]",
          LOOK[block.kind],
        )}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onFocus={handlers.onFocus}
        onPaste={(e) => {
          e.preventDefault();
          // shortcut: a paste goes in as plain text on one line; split pasted paragraphs into blocks once asked.
          document.execCommand(
            "insertText",
            false,
            e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "),
          );
        }}
      />
    </div>
  );
}

const field =
  "w-full resize-none rounded-xl border border-white/[0.12] bg-white/[0.04] p-3 font-mono text-[14px] leading-6 outline-hidden field-sizing-content focus:border-[#1d9bf0]";

/** An atomic block of X's Insert menu: its source in a box, with X's "Delete block". */
function Atomic({
  block,
  onChange,
  onRemove,
}: {
  readonly block: Exclude<ArticleBlock, TextBlock>;
  readonly onChange: (block: Exclude<ArticleBlock, TextBlock>) => void;
  readonly onRemove: () => void;
}) {
  const remove = (
    <button
      type="button"
      aria-label="Delete block"
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-[#71767b] hover:bg-white/10 hover:text-foreground"
      onClick={onRemove}
    >
      <X className="size-4" />
    </button>
  );
  if (block.kind === "divider")
    return (
      <div className="flex items-center gap-2" data-kind="divider">
        <hr className="flex-1 border-white/[0.24]" />
        {remove}
      </div>
    );
  if (block.kind === "post") {
    const bad = block.url.trim() !== "" && embeddedPostId(block.url) === null;
    return (
      <div className="flex flex-col gap-1" data-kind="post">
        <div className="flex items-center gap-2">
          <input
            aria-label="Paste post URL"
            placeholder="Paste post URL"
            className="h-10 flex-1 rounded-xl border border-white/[0.12] bg-transparent px-3 text-[15px] outline-hidden focus:border-[#1d9bf0]"
            value={block.url}
            onChange={(e) => onChange({ kind: "post", url: e.target.value })}
          />
          {remove}
        </div>
        {bad ? <p className="text-[13px] text-error-foreground">Invalid post URL</p> : null}
      </div>
    );
  }
  const label =
    block.kind === "code"
      ? "Add code here"
      : block.kind === "latex"
        ? "Add a LaTeX expression here"
        : "Markdown";
  return (
    <div className="flex flex-col gap-1.5" data-kind={block.kind}>
      <div className="flex items-center gap-2 text-[13px] text-[#71767b]">
        {block.kind === "code" ? (
          <input
            aria-label="Select a programming language"
            placeholder="Select a programming language"
            className="h-7 flex-1 bg-transparent outline-hidden"
            value={block.lang}
            onChange={(e) => onChange({ ...block, lang: e.target.value.trim() })}
          />
        ) : (
          <span className="flex-1">{block.kind === "latex" ? "LaTeX" : "Markdown"}</span>
        )}
        {remove}
      </div>
      <textarea
        aria-label={label}
        placeholder={label}
        className={field}
        value={block.text}
        onChange={(e) => onChange({ ...block, text: e.target.value })}
      />
    </div>
  );
}

/**
 * The body as X's editor shows it, block by block: text blocks edited in place, atomic ones as
 * their source. `focus` asks for the caret in a block; the editor clears it once it is there.
 */
export function ArticleBlocks({
  blocks,
  focus,
  onFocused,
  handlersFor,
  onAtomic,
  onRemove,
}: {
  readonly blocks: ReadonlyArray<ArticleBlock>;
  readonly focus: { readonly index: number; readonly at: number } | null;
  readonly onFocused: () => void;
  readonly handlersFor: (index: number) => TextHandlers;
  readonly onAtomic: (index: number, block: Exclude<ArticleBlock, TextBlock>) => void;
  readonly onRemove: (index: number) => void;
}) {
  return (
    <div data-x="article-editor" className="flex flex-col gap-4 px-4 py-5">
      {blocks.map((b, i) =>
        isTextBlock(b) ? (
          <RichText
            // oxlint-disable-next-line react/no-array-index-key -- a block is its place in the body: the body has no ids, and a split or join redraws the blocks after it.
            key={i}
            block={b}
            index={i}
            marker={
              b.kind === "bullet"
                ? "•"
                : b.kind === "number"
                  ? `${i - blocks.slice(0, i).findLastIndex((x) => x.kind !== "number")}.`
                  : null
            }
            focus={focus?.index === i ? focus.at : null}
            onFocused={onFocused}
            handlers={handlersFor(i)}
          />
        ) : (
          <Atomic
            // oxlint-disable-next-line react/no-array-index-key -- as above.
            key={i}
            block={b}
            onChange={(next) => onAtomic(i, next)}
            onRemove={() => onRemove(i)}
          />
        ),
      )}
    </div>
  );
}

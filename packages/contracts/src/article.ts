import { charCount } from "./compose.ts";
import type { EngineArticleBlock } from "./desktop.ts";

/**
 * An Xtend article draft's body. The draft stores it as Markdown (`Draft.body`), one block per
 * line as X's editor makes one block per Enter; this module reads it into blocks, writes it back,
 * and turns it into what X takes: the API's Draft.js content state and the HTML X's editor
 * keeps from a paste. Its rules follow X's editor (bundle.TwitterArticles and its shared chunks).
 */

/** A block of X's editor: X's text styles, and the atomic blocks of its Insert menu. */
export type ArticleBlock =
  | {
      readonly kind: "body" | "heading" | "subheading" | "quote" | "bullet" | "number";
      readonly text: string;
    }
  | { readonly kind: "code"; readonly lang: string; readonly text: string }
  /** X's Markdown block, which also holds its tables. */
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "latex"; readonly text: string }
  | { readonly kind: "divider" }
  /** An embedded post, by its x.com link. */
  | { readonly kind: "post"; readonly url: string };

export type ArticleBlockKind = ArticleBlock["kind"];

/** X's text styles in its toolbar's menu: Body (unstyled), Heading and Subheading. */
export const TEXT_KINDS = ["body", "heading", "subheading", "quote", "bullet", "number"] as const;
export const isTextBlock = (
  b: ArticleBlock,
): b is Extract<ArticleBlock, { readonly kind: (typeof TEXT_KINDS)[number] }> =>
  (TEXT_KINDS as ReadonlyArray<string>).includes(b.kind);

/**
 * X's limits for an Article, the defaults its editor falls back to when X's feature switches send
 * none (`responsive_web_twitter_article_title_limit`, `_character_limit` in thousands,
 * `_media_limit`). X may send others to an account; these are the ones its code names.
 */
export const ARTICLE_LIMITS = { title: 100, characters: 25_000, media: 25 } as const;

/** X's hint under the title: "We recommend a title between 50-70 characters". */
export const ARTICLE_TITLE_RECOMMENDED = [50, 70] as const;

const POST_URL =
  /^https:\/\/(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/(\d{1,25})\/?$/;

/** The post an embed's link names, or null for a link that is not one. */
export const embeddedPostId = (url: string) => POST_URL.exec(url.trim())?.[1] ?? null;

const PREFIX: Readonly<Record<string, string>> = {
  heading: "# ",
  subheading: "## ",
  quote: "> ",
  bullet: "- ",
};

/** A body line that would read back as another block keeps its first character escaped. */
const MARKER = /^(#{1,2} |> |[-*] |\d+\. |```|\$\$|---$|\||\\)/;

/** The draft body's blocks. Blank lines only separate; unknown Markdown stays body text. */
export function parseArticle(body: string): Array<ArticleBlock> {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const out: Array<ArticleBlock> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null || line === "$$") {
      const close = fence !== null ? "```" : "$$";
      const end = lines.findIndex((l, j) => j > i && l === close);
      const inner = lines.slice(i + 1, end === -1 ? lines.length : end).join("\n");
      i = end === -1 ? lines.length : end;
      const lang = fence?.[1]?.trim() ?? "";
      out.push(
        fence === null
          ? { kind: "latex", text: inner }
          : lang === "markdown"
            ? { kind: "markdown", text: inner }
            : { kind: "code", lang, text: inner },
      );
      continue;
    }
    if (line.startsWith("|")) {
      let end = i;
      while (lines[end + 1]?.startsWith("|") === true) end++;
      out.push({ kind: "markdown", text: lines.slice(i, end + 1).join("\n") });
      i = end;
      continue;
    }
    if (line.trim() === "") continue;
    if (line === "---") out.push({ kind: "divider" });
    else if (embeddedPostId(line) !== null) out.push({ kind: "post", url: line.trim() });
    else if (line.startsWith("## ")) out.push({ kind: "subheading", text: line.slice(3) });
    else if (line.startsWith("# ")) out.push({ kind: "heading", text: line.slice(2) });
    else if (line.startsWith("> ")) out.push({ kind: "quote", text: line.slice(2) });
    else if (/^[-*] /.test(line)) out.push({ kind: "bullet", text: line.slice(2) });
    else if (/^\d+\. /.test(line)) out.push({ kind: "number", text: line.replace(/^\d+\. /, "") });
    else out.push({ kind: "body", text: line.startsWith("\\") ? line.slice(1) : line });
  }
  return out;
}

/** The body for these blocks; `parseArticle` reads it back to the same blocks. */
export function serializeArticle(blocks: ReadonlyArray<ArticleBlock>): string {
  let n = 0;
  return blocks
    .map((b, i) => {
      n = b.kind === "number" ? (blocks[i - 1]?.kind === "number" ? n + 1 : 1) : 0;
      // A list's items sit on consecutive lines; every other block has a blank line before it.
      const gap =
        i === 0
          ? ""
          : b.kind === blocks[i - 1]!.kind && (b.kind === "bullet" || b.kind === "number")
            ? "\n"
            : "\n\n";
      return gap + blockLine(b, n);
    })
    .join("");
}

function blockLine(b: ArticleBlock, n: number): string {
  switch (b.kind) {
    case "code":
      return `\`\`\`${b.lang}\n${b.text}\n\`\`\``;
    case "markdown":
      // A table reads back as itself; other Markdown rides in a fence of its own.
      return b.text.split("\n").every((l) => l.startsWith("|")) && b.text !== ""
        ? b.text
        : `\`\`\`markdown\n${b.text}\n\`\`\``;
    case "latex":
      return `$$\n${b.text}\n$$`;
    case "divider":
      return "---";
    case "post":
      return b.url;
    case "number":
      return `${n}. ${b.text.replaceAll("\n", " ")}`;
    case "body": {
      const text = b.text.replaceAll("\n", " ");
      return MARKER.test(text) || embeddedPostId(text) !== null ? `\\${text}` : text;
    }
    default:
      return `${PREFIX[b.kind]}${b.text.replaceAll("\n", " ")}`;
  }
}

/** X's inline styles, by the names its editor saves them under. */
export type InlineStyle = "Bold" | "Italic" | "Strikethrough";
const isInlineStyle = (style: string): style is InlineStyle =>
  style === "Bold" || style === "Italic" || style === "Strikethrough";
const MARKS: ReadonlyArray<readonly [string, InlineStyle]> = [
  ["**", "Bold"],
  ["~~", "Strikethrough"],
  ["*", "Italic"],
];

export interface InlineText {
  readonly text: string;
  /** Offsets count code points, as X's editor (Draft.js) does. */
  readonly styles: ReadonlyArray<{
    readonly offset: number;
    readonly length: number;
    readonly style: InlineStyle;
  }>;
  readonly links: ReadonlyArray<{
    readonly offset: number;
    readonly length: number;
    readonly url: string;
  }>;
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/y;
const ESCAPABLE = /[*~[\]\\]/;

/**
 * A block's text from its Markdown: `**bold**`, `*italic*`, `~~struck~~` and `[text](https://…)`,
 * X's three styles and its links. A mark without a partner stays as written; `\` escapes one.
 */
export function readInline(source: string): InlineText {
  type Token =
    | { readonly at: number; readonly kind: "char"; readonly ch: string; readonly next: number }
    | {
        readonly at: number;
        readonly kind: "mark";
        readonly mark: string;
        readonly style: InlineStyle;
        readonly next: number;
      }
    | {
        readonly at: number;
        readonly kind: "link";
        readonly label: string;
        readonly url: string;
        readonly next: number;
      };
  const tokens: Array<Token> = [];
  for (let i = 0; i < source.length;) {
    if (source[i] === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) {
      tokens.push({ at: i, kind: "char", ch: source[i + 1]!, next: i + 2 });
      i += 2;
      continue;
    }
    LINK.lastIndex = i;
    const link = LINK.exec(source);
    if (link !== null) {
      tokens.push({ at: i, kind: "link", label: link[1]!, url: link[2]!, next: LINK.lastIndex });
      i = LINK.lastIndex;
      continue;
    }
    const mark = MARKS.find(([m]) => source.startsWith(m, i));
    if (mark !== undefined) {
      tokens.push({ at: i, kind: "mark", mark: mark[0], style: mark[1], next: i + mark[0].length });
      i += mark[0].length;
      continue;
    }
    const ch = String.fromCodePoint(source.codePointAt(i)!);
    tokens.push({ at: i, kind: "char", ch, next: i + ch.length });
    i += ch.length;
  }
  // Marks pair in order per style; an odd one out is plain text.
  const paired = new Set<number>();
  for (const [, style] of MARKS) {
    const at = tokens.flatMap((t, i) => (t.kind === "mark" && t.style === style ? [i] : []));
    for (let k = 0; k + 1 < at.length; k += 2) paired.add(at[k]!).add(at[k + 1]!);
  }
  let text = "";
  let length = 0;
  const open = new Map<InlineStyle, number>();
  const styles: Array<InlineText["styles"][number]> = [];
  const links: Array<InlineText["links"][number]> = [];
  tokens.forEach((t, i) => {
    if (t.kind === "mark" && paired.has(i)) {
      const start = open.get(t.style);
      if (start === undefined) open.set(t.style, length);
      else {
        open.delete(t.style);
        if (length > start) styles.push({ offset: start, length: length - start, style: t.style });
      }
      return;
    }
    if (t.kind === "link") {
      // A link's label carries its own styles: `[**Read this**](…)`.
      const label = readInline(t.label);
      const n = [...label.text].length;
      links.push({ offset: length, length: n, url: t.url });
      styles.push(...label.styles.map((x) => ({ ...x, offset: x.offset + length })));
      text += label.text;
      length += n;
      return;
    }
    const piece = t.kind === "char" ? t.ch : t.mark;
    text += piece;
    length += [...piece].length;
  });
  return { text, styles: merged(styles), links };
}

/** Ranges of one style that touch or overlap as one, in order: a link's edge splits none. */
function merged(styles: ReadonlyArray<InlineText["styles"][number]>) {
  const out: Array<InlineText["styles"][number]> = [];
  for (const x of styles.toSorted((a, b) => a.offset - b.offset)) {
    const last = out.findLast((o) => o.style === x.style);
    if (last !== undefined && x.offset <= last.offset + last.length) {
      const end = Math.max(last.offset + last.length, x.offset + x.length);
      out[out.indexOf(last)] = { ...last, length: end - last.offset };
    } else out.push(x);
  }
  return out;
}

/** The Markdown for text with X's styles and links; `readInline` reads it back. */
export function writeInline(inline: InlineText): string {
  const chars = [...inline.text];
  const at = (n: number) => ({
    styles: new Set(
      inline.styles.filter((s) => s.offset <= n && n < s.offset + s.length).map((s) => s.style),
    ),
    link: inline.links.find((l) => l.offset <= n && n < l.offset + l.length),
  });
  let out = "";
  let prev = at(-1);
  for (let n = 0; n <= chars.length; n++) {
    const cur = n < chars.length ? at(n) : { styles: new Set<InlineStyle>(), link: undefined };
    // Close what ends here (inner first), then the link, then open what starts. At a link's
    // edge every style closes and opens again, so a label's marks pair inside its brackets.
    const edge = prev.link !== cur.link;
    for (const [mark, style] of [...MARKS].toReversed())
      if (prev.styles.has(style) && (edge || !cur.styles.has(style))) out += mark;
    if (prev.link !== undefined && edge) out += `](${prev.link.url})`;
    if (cur.link !== undefined && edge) out += "[";
    for (const [mark, style] of MARKS)
      if (cur.styles.has(style) && (edge || !prev.styles.has(style))) out += mark;
    if (n < chars.length) out += ESCAPABLE.test(chars[n]!) ? `\\${chars[n]}` : chars[n];
    prev = cur;
  }
  return out;
}

/** The part of `inline` from code point `from` to `to`, its styles and links cut to fit. */
export function sliceInline(
  inline: InlineText,
  from: number,
  to = [...inline.text].length,
): InlineText {
  const cut = <R extends { readonly offset: number; readonly length: number }>(r: R) => {
    const start = Math.max(r.offset, from);
    const end = Math.min(r.offset + r.length, to);
    return end > start ? [{ ...r, offset: start - from, length: end - start }] : [];
  };
  return {
    text: [...inline.text].slice(from, to).join(""),
    styles: inline.styles.flatMap(cut),
    links: inline.links.flatMap(cut),
  };
}

/** Texts one after another, as one. */
export function joinInline(...parts: ReadonlyArray<InlineText>): InlineText {
  let at = 0;
  const out = {
    text: "",
    styles: [] as Array<InlineText["styles"][number]>,
    links: [] as Array<InlineText["links"][number]>,
  };
  for (const p of parts) {
    out.text += p.text;
    out.styles.push(...p.styles.map((s) => ({ ...s, offset: s.offset + at })));
    out.links.push(...p.links.map((l) => ({ ...l, offset: l.offset + at })));
    at += [...p.text].length;
  }
  return out;
}

const DRAFT_TYPES = {
  body: "unstyled",
  heading: "header-one",
  subheading: "header-two",
  quote: "blockquote",
  bullet: "unordered-list-item",
  number: "ordered-list-item",
} as const satisfies Record<(typeof TEXT_KINDS)[number], string>;

const fenced = (lang: string, text: string) => `\`\`\`${lang}\n${text}\n\`\`\``;

/**
 * The body as X's reader draws an Article (`EngineArticleBlock`), for Xtend's preview. Atomic
 * blocks carry what the reader draws of them: a code block or table as its Markdown, a divider,
 * LaTeX or post as a line of its source.
 */
export function toReaderBlocks(body: string): Array<EngineArticleBlock> {
  return parseArticle(body).map((b, i): EngineArticleBlock => {
    const key = String(i);
    const empty = { key, styles: [], links: [], images: [], markdown: null };
    if (isTextBlock(b)) return { ...empty, ...readInline(b.text), type: DRAFT_TYPES[b.kind] };
    switch (b.kind) {
      case "code":
        return { ...empty, type: "atomic", text: " ", markdown: fenced(b.lang, b.text) };
      case "markdown":
        return { ...empty, type: "atomic", text: " ", markdown: b.text };
      case "latex":
        return { ...empty, type: "code-block", text: b.text };
      case "divider":
        return { ...empty, type: "unstyled", text: "* * *" };
      case "post":
        return {
          ...empty,
          type: "unstyled",
          text: b.url,
          links: [{ offset: 0, length: [...b.url].length, url: b.url }],
        };
    }
  });
}

/** An X Article's blocks (as the engine read them off X) as an Xtend draft body. */
export function fromReaderBlocks(blocks: ReadonlyArray<EngineArticleBlock>): string {
  const kinds = new Map<string, (typeof TEXT_KINDS)[number]>(
    Object.entries(DRAFT_TYPES).map(([k, v]) => [v, k as (typeof TEXT_KINDS)[number]]),
  );
  const out = blocks.flatMap((b): Array<ArticleBlock> => {
    if (b.type === "atomic") {
      if (b.markdown === null) return [];
      const code = /^```([^\n]*)\n([\s\S]*?)\n?```\s*$/.exec(b.markdown.trim());
      return [
        code === null
          ? { kind: "markdown", text: b.markdown }
          : { kind: "code", lang: code[1]!.trim(), text: code[2]! },
      ];
    }
    const styles = b.styles.flatMap((s) =>
      isInlineStyle(s.style) ? [{ offset: s.offset, length: s.length, style: s.style }] : [],
    );
    const text = writeInline({ text: b.text, styles, links: b.links });
    return text.trim() === "" ? [] : [{ kind: kinds.get(b.type) ?? "body", text }];
  });
  return serializeArticle(out);
}

/** X's API content state for the body: the Draft.js blocks and entities POST /2/articles/draft takes. */
export function toContentState(body: string) {
  const entities: Array<{
    readonly key: string;
    readonly value: {
      readonly type: string;
      readonly mutability: "mutable" | "immutable";
      readonly data: Record<string, string>;
    };
  }> = [];
  const entity = (
    type: string,
    mutability: "mutable" | "immutable",
    data: Record<string, string>,
  ) => {
    entities.push({ key: String(entities.length), value: { type, mutability, data } });
    return entities.length - 1;
  };
  const atomic = (key: number, text = " ") => ({
    text,
    type: "atomic",
    entity_ranges: [{ key, offset: 0, length: [...text].length }],
    inline_style_ranges: [],
  });
  const blocks = parseArticle(body).map((b) => {
    if (isTextBlock(b)) {
      const inline = readInline(b.text);
      return {
        text: inline.text,
        type: DRAFT_TYPES[b.kind],
        inline_style_ranges: inline.styles.map((s) => ({
          offset: s.offset,
          length: s.length,
          style: s.style.toLowerCase(),
        })),
        entity_ranges: inline.links.map((l) => ({
          key: entity("link", "mutable", { url: l.url }),
          offset: l.offset,
          length: l.length,
        })),
      };
    }
    switch (b.kind) {
      case "code":
        return atomic(entity("markdown", "mutable", { markdown: fenced(b.lang, b.text) }));
      case "markdown":
        return atomic(entity("markdown", "mutable", { markdown: b.text }));
      case "latex":
        // X keeps LaTeX's source as the block's text.
        return atomic(entity("latex", "immutable", {}), b.text);
      case "divider":
        return atomic(entity("divider", "immutable", {}));
      case "post":
        return atomic(entity("post", "immutable", { post_id: embeddedPostId(b.url) ?? "" }));
    }
  });
  return { blocks, entities };
}

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const TAGS: Readonly<Record<InlineStyle, string>> = {
  Bold: "strong",
  Italic: "em",
  Strikethrough: "del",
};

/** A block's Markdown as the HTML X's editor keeps: `strong`, `em`, `del` and links, escaped. */
export function inlineToHtml(source: string): string {
  const { text, styles, links } = readInline(source);
  const chars = [...text];
  // Cut wherever a style or link starts or ends; each run gets the elements that cover it.
  const cuts = [
    ...new Set([
      0,
      chars.length,
      ...[...styles, ...links].flatMap((r) => [r.offset, r.offset + r.length]),
    ]),
  ]
    .filter((n) => n >= 0 && n <= chars.length)
    .toSorted((a, b) => a - b);
  return cuts
    .slice(0, -1)
    .map((start, i) => {
      const end = cuts[i + 1]!;
      const covers = (r: { readonly offset: number; readonly length: number }) =>
        r.offset <= start && r.offset + r.length >= end;
      const styled = styles
        .filter(covers)
        .reduce(
          (html, s) => `<${TAGS[s.style]}>${html}</${TAGS[s.style]}>`,
          escapeHtml(chars.slice(start, end).join("")),
        );
      const link = links.find(covers);
      return link === undefined ? styled : `<a href="${escapeHtml(link.url)}">${styled}</a>`;
    })
    .join("");
}

/**
 * The body as HTML for one paste into X's editor, which keeps from it paragraphs, Heading,
 * Subheading, quotes, both lists, bold, italic, strikethrough and links. Null when the body has
 * an atomic block (code, Markdown, LaTeX, a divider, a post), which X's paste drops.
 */
export function toPasteHtml(body: string): string | null {
  const blocks = parseArticle(body);
  if (!blocks.every(isTextBlock)) return null;
  const tag = { body: "p", heading: "h1", subheading: "h2", quote: "blockquote" } as const;
  return blocks
    .map((b, i) => {
      if (b.kind === "bullet" || b.kind === "number") {
        const list = b.kind === "bullet" ? "ul" : "ol";
        const first = blocks[i - 1]?.kind !== b.kind;
        const last = blocks[i + 1]?.kind !== b.kind;
        return `${first ? `<${list}>` : ""}<li>${inlineToHtml(b.text)}</li>${last ? `</${list}>` : ""}`;
      }
      return `<${tag[b.kind]}>${inlineToHtml(b.text)}</${tag[b.kind]}>`;
    })
    .join("");
}

/** The plain text X's editor counts: each block's text, an atomic one's a space, by line breaks. */
const plainText = (body: string) =>
  parseArticle(body)
    .map((b) => (isTextBlock(b) ? readInline(b.text).text : b.kind === "latex" ? b.text : " "))
    .join("\n");

/** X's word count, as its editor's toolbar shows it. */
export const articleWords = (body: string) =>
  plainText(body)
    .split(/\s+/)
    .filter((w) => w !== "").length;

/**
 * What X's Publish says before it lets an Article go, in X's words (bundle.TwitterArticles), or
 * null when X would publish it.
 */
export function articleBlocker(title: string, body: string): string | null {
  const hasTitle = title.trim() !== "";
  const hasContent = plainText(body).trim() !== "";
  const titleLong = charCount(title) > ARTICLE_LIMITS.title;
  const bodyLong = plainText(body).length > ARTICLE_LIMITS.characters;
  if (!hasTitle && !hasContent) return "Your Article needs a title and content before publishing.";
  if (!hasTitle && bodyLong)
    return "Your Article needs a title, and your Article is over the word count. Add a title, shorten the body text, and then publish.";
  if (!hasContent && titleLong)
    return "Your title is over the character limit. Shorten the title, add something to the body, and then publish.";
  if (!hasTitle) return "Your Article needs a title before publishing.";
  if (!hasContent) return "Your Article has a title, but needs content before publishing.";
  if (titleLong && bodyLong)
    return "Your title is over the character limit, and your Article is over the word count. Shorten both, then publish.";
  if (titleLong) return "Your title is over the character limit. Shorten it, then publish.";
  if (bodyLong)
    return "Your Article is over the character limit. Shorten the body text, then publish.";
  return null;
}

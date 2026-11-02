import type { EngineArticleBlock } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { xtendRoute } from "./RichText";

/** X's inline styles as HTML's own; one X adds later draws plain. A Map: X's names are data. */
const TAGS = new Map<string, "strong" | "em" | "u" | "s">([
  ["Bold", "strong"],
  ["Italic", "em"],
  ["Underline", "u"],
  ["Strikethrough", "s"],
]);

/**
 * A block's text cut wherever a style or a link starts or ends, each piece with what covers it.
 * Offsets count code points, as X's editor does, so an emoji before a bold word moves it by one.
 */
function pieces(block: EngineArticleBlock) {
  const chars = [...block.text];
  const clamp = (n: number) => Math.min(Math.max(n, 0), chars.length);
  const cuts = [
    ...new Set([
      0,
      chars.length,
      ...[...block.styles, ...block.links].flatMap((r) => [
        clamp(r.offset),
        clamp(r.offset + r.length),
      ]),
    ]),
  ].toSorted((a, b) => a - b);
  return cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1]!;
    const covers = (r: { readonly offset: number; readonly length: number }) =>
      r.offset <= start && r.offset + r.length >= end;
    return {
      start,
      text: chars.slice(start, end).join(""),
      styles: block.styles.filter(covers).map((s) => s.style),
      url: block.links.find(covers)?.url ?? null,
    };
  });
}

/** A Markdown table's header and rows; null for any other Markdown. */
function markdownTable(markdown: string) {
  const rows = markdown.trim().split("\n");
  if (rows.length < 2 || !rows.every((r) => r.trim().startsWith("|"))) return null;
  if (!/^\|[\s:|-]+$/.test(rows[1]!.trim())) return null;
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  return { head: cells(rows[0]!), rows: rows.slice(2).map(cells) };
}

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/;
const BOX = "overflow-x-auto rounded-2xl border border-white/[0.12]";

// shortcut: Markdown inside a table cell draws as its source; render it once X Articles lean on it.
function Markdown({ markdown }: { readonly markdown: string }) {
  const table = markdownTable(markdown);
  if (table === null)
    return (
      <pre className={cn(BOX, "bg-white/[0.04] p-4 font-mono text-[14px] leading-6")}>
        <code>{FENCE.exec(markdown.trim())?.[1] ?? markdown}</code>
      </pre>
    );
  return (
    <div className={BOX}>
      <table className="w-full text-left text-[15px]">
        <thead>
          <tr>
            {table.head.map((c, i) => (
              // oxlint-disable-next-line react/no-array-index-key -- a table's cells have no id and never reorder.
              <th key={i} className="border-b border-white/[0.12] px-3 py-2 font-bold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            // oxlint-disable-next-line react/no-array-index-key -- as above.
            <tr key={r} className="border-b border-white/[0.12] last:border-b-0">
              {row.map((c, i) => (
                // oxlint-disable-next-line react/no-array-index-key -- as above.
                <td key={i} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A block's text with its styles and links; a link opens where RichText's would. */
function Text({ block }: { readonly block: EngineArticleBlock }) {
  const navigate = useNavigate();
  return pieces(block).map((p) => {
    const styled = p.styles.reduce<ReactNode>((node, style) => {
      const Tag = TAGS.get(style);
      return Tag === undefined ? node : <Tag>{node}</Tag>;
    }, p.text);
    if (p.url === null) return <Fragment key={p.start}>{styled}</Fragment>;
    const href = p.url;
    return (
      <a
        key={p.start}
        href={href}
        className="text-[#1d9bf0] hover:underline"
        onClick={(e) => {
          e.preventDefault();
          const inside = xtendRoute(href);
          if (inside !== null) void navigate({ href: inside });
          else window.desktopBridge?.openExternal(href);
        }}
      >
        {styled}
      </a>
    );
  });
}

const LISTS = new Map<string, "ul" | "ol">([
  ["unordered-list-item", "ul"],
  ["ordered-list-item", "ol"],
]);

function Block({ block }: { readonly block: EngineArticleBlock }): ReactNode {
  const text = <Text block={block} />;
  switch (block.type) {
    case "header-one":
      return <h2 className="text-[26px] leading-8 font-extrabold">{text}</h2>;
    case "header-two":
      return <h3 className="text-[22px] leading-7 font-bold">{text}</h3>;
    case "header-three":
      return <h4 className="text-[19px] leading-6 font-bold">{text}</h4>;
    case "blockquote":
      return <blockquote className="border-l-2 border-white/40 pl-4 italic">{text}</blockquote>;
    case "code-block":
      return (
        <pre className={cn(BOX, "bg-white/[0.04] p-4 font-mono text-[14px] leading-6")}>
          {block.text}
        </pre>
      );
    case "atomic":
      if (block.images.length > 0)
        return block.images.map((img) => (
          <img
            key={img.url}
            src={img.url}
            alt=""
            loading="lazy"
            width={img.width || undefined}
            height={img.height || undefined}
            className="h-auto w-full rounded-2xl border border-white/[0.12] bg-white/[0.04]"
          />
        ));
      if (block.markdown !== null) return <Markdown markdown={block.markdown} />;
  }
  // An unstyled paragraph, and any block X's editor makes that Xtend does not know: its text.
  return block.text.trim() === "" ? null : <p>{text}</p>;
}

/**
 * An X Article's body as X's reader draws it: paragraphs, headings, quotes, lists, code, its images
 * and tables. Text goes through React only; X's Markdown is shown, never run as HTML.
 */
export function ArticleBody({ blocks }: { readonly blocks: ReadonlyArray<EngineArticleBlock> }) {
  // Consecutive items of one kind of list are one list.
  const groups = blocks.reduce<Array<Array<EngineArticleBlock>>>((out, b) => {
    const last = out.at(-1);
    if (last !== undefined && LISTS.has(b.type) && last[0]!.type === b.type) last.push(b);
    else out.push([b]);
    return out;
  }, []);
  return (
    <div
      data-x="article-body"
      className="flex flex-col gap-4 px-4 py-5 text-[17px] leading-7 break-words whitespace-pre-wrap"
    >
      {groups.map((group) => {
        const first = group[0]!;
        const List = LISTS.get(first.type);
        if (List === undefined) return <Block key={first.key} block={first} />;
        return (
          <List
            key={first.key}
            className={cn("pl-6", List === "ul" ? "list-disc" : "list-decimal")}
          >
            {group.map((b) => (
              <li key={b.key} className="pl-1">
                <Text block={b} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

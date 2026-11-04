import { describe, expect, it } from "vite-plus/test";

import type { EngineArticleBlock } from "./desktop.ts";

import {
  articleBlocker,
  articleWords,
  copyLeavesOut,
  fromReaderBlocks,
  parseArticle,
  readInline,
  serializeArticle,
  toContentState,
  toPasteHtml,
  writeInline,
} from "./article.ts";

const BODY = [
  "# What we changed",
  "We cut the **middle** plan and *moved* its ~~two~~ best [features](https://example.com/f).",
  "> If a buyer has to compare, they stop to think.",
  "- Starter: $19",
  "- Team: $49",
  "1. First",
  "2. Second",
  "\\# not a heading",
].join("\n\n");

describe("article body", () => {
  it("reads and writes every block X's editor makes, back to the same blocks", () => {
    const blocks = parseArticle(
      `${BODY}\n\n---\n\n\`\`\`ts\nconst a = 1;\n\`\`\`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\nhttps://x.com/jon/status/123`,
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "body",
      "quote",
      "bullet",
      "bullet",
      "number",
      "number",
      "body",
      "divider",
      "code",
      "markdown",
      "latex",
      "post",
    ]);
    expect(blocks[7]).toEqual({ kind: "body", text: "# not a heading" });
    expect(parseArticle(serializeArticle(blocks))).toEqual(blocks);
  });

  it("reads X's three styles and links in code points, and leaves an unpaired mark as text", () => {
    expect(readInline("🙂 **big** 2*3 [x](https://e.com)")).toEqual({
      text: "🙂 big 2*3 x",
      styles: [{ offset: 2, length: 3, style: "Bold" }],
      links: [{ offset: 10, length: 1, url: "https://e.com" }],
    });
    const overlap = {
      text: "abcdefgh",
      styles: [
        { offset: 0, length: 5, style: "Bold" as const },
        { offset: 2, length: 6, style: "Italic" as const },
      ],
      links: [],
    };
    expect(readInline(writeInline(overlap))).toEqual(overlap);
  });

  it("keeps a link's own styles, and a style across a link's edge, through Markdown and back", () => {
    const bold = {
      text: "Read this now",
      styles: [{ offset: 0, length: 9, style: "Bold" as const }],
      links: [{ offset: 0, length: 9, url: "https://e.com" }],
    };
    expect(writeInline(bold)).toBe("[**Read this**](https://e.com) now");
    expect(readInline(writeInline(bold))).toEqual(bold);
    const crossing = {
      text: "a big link",
      styles: [{ offset: 2, length: 5, style: "Italic" as const }],
      links: [{ offset: 6, length: 4, url: "https://e.com" }],
    };
    expect(readInline(writeInline(crossing))).toEqual(crossing);
    expect(toContentState("[**Read**](https://e.com)").blocks[0]).toMatchObject({
      text: "Read",
      inline_style_ranges: [{ offset: 0, length: 4, style: "bold" }],
    });
  });

  it("gives X's API its Draft.js content state, atomic blocks as entities", () => {
    const state = toContentState(
      "Hi **you** [me](https://e.com)\n\n---\n\n```py\nx\n```\n\nhttps://x.com/jon/status/123",
    );
    expect(state.blocks[0]).toEqual({
      text: "Hi you me",
      type: "unstyled",
      inline_style_ranges: [{ offset: 3, length: 3, style: "bold" }],
      entity_ranges: [{ key: 0, offset: 7, length: 2 }],
    });
    expect(state.blocks.slice(1).map((b) => [b.type, b.entity_ranges[0]?.key])).toEqual([
      ["atomic", 1],
      ["atomic", 2],
      ["atomic", 3],
    ]);
    expect(state.entities.map((e) => [e.value.type, e.value.data])).toEqual([
      ["link", { url: "https://e.com" }],
      ["divider", {}],
      ["markdown", { markdown: "```py\nx\n```" }],
      ["post", { post_id: "123" }],
    ]);
  });

  it("pastes text blocks as the HTML X's editor keeps, and refuses atomic ones", () => {
    expect(toPasteHtml("# T\n\n- a\n- b\n\n> q **b**")).toBe(
      "<h1>T</h1><ul><li>a</li><li>b</li></ul><blockquote>q <strong>b</strong></blockquote>",
    );
    expect(toPasteHtml("a <b>&\n\n---")).toBeNull();
    expect(toPasteHtml("a <b>&")).toBe("<p>a &lt;b&gt;&amp;</p>");
  });

  it("copies an X Article's blocks into a draft body", () => {
    const body = fromReaderBlocks([
      {
        key: "a",
        type: "header-two",
        text: "Sub",
        styles: [],
        links: [],
        images: [],
        markdown: null,
      },
      {
        key: "b",
        type: "unstyled",
        text: "bold * star",
        styles: [{ offset: 0, length: 4, style: "Bold" }],
        links: [],
        images: [],
        markdown: null,
      },
      {
        key: "c",
        type: "atomic",
        text: " ",
        styles: [],
        links: [],
        images: [],
        markdown: "```js\n1\n```",
      },
    ]);
    expect(parseArticle(body)).toEqual([
      { kind: "subheading", text: "Sub" },
      { kind: "body", text: "**bold** \\* star" },
      { kind: "code", lang: "js", text: "1" },
    ]);
  });

  it("counts what Copy to Xtend leaves out of an X Article: its images, and atomic blocks with no Markdown", () => {
    const block = (extra: Partial<EngineArticleBlock>): EngineArticleBlock => ({
      key: "k",
      type: "atomic",
      text: " ",
      styles: [],
      links: [],
      images: [],
      markdown: null,
      ...extra,
    });
    const image = { url: "https://pbs.twimg.com/media/a.jpg", width: 1, height: 1 };
    expect(
      copyLeavesOut(
        [
          block({ type: "unstyled", text: "kept" }),
          block({ markdown: "| a |" }),
          block({ images: [image, image] }),
          block({}),
        ],
        null,
      ),
    ).toEqual({ cover: false, images: 2, blocks: 1 });
    // A text-only Article loses its cover too.
    expect(copyLeavesOut([block({ type: "unstyled", text: "kept" })], image.url)).toEqual({
      cover: true,
      images: 0,
      blocks: 0,
    });
  });

  it("says what X's Publish says, in X's order", () => {
    expect(articleBlocker("", "")).toBe(
      "Your Article needs a title and content before publishing.",
    );
    expect(articleBlocker("", "text")).toBe("Your Article needs a title before publishing.");
    expect(articleBlocker("T", "---")).toBe(
      "Your Article has a title, but needs content before publishing.",
    );
    expect(articleBlocker("x".repeat(101), "text")).toBe(
      "Your title is over the character limit. Shorten it, then publish.",
    );
    expect(articleBlocker("T", "x".repeat(25_001))).toBe(
      "Your Article is over the character limit. Shorten the body text, then publish.",
    );
    expect(articleWords(BODY)).toBe(34);
  });
});

import { expect, it } from "vite-plus/test";

import { applyCapture, emptyLegacy, markdownBlocks } from "./grokLegacy";

const items = (restId: string, list: ReadonlyArray<Record<string, unknown>>) =>
  ({
    kind: "graphql",
    op: "GrokConversationItemsByRestId",
    variables: { restId },
    body: { data: { grok_conversation_items_by_rest_id: { items: list } } },
  }) as const;
const line = (value: unknown) =>
  ({ kind: "chunk", stream: "1", line: JSON.stringify(value) }) as const;

it("reads X's conversation items in order and grows the streamed answer word by word", () => {
  // X lists items newest first.
  let s = applyCapture(
    emptyLegacy,
    items("c1", [
      { chat_item_id: "a1", sender_type: "Agent", message: "Two camps." },
      { chat_item_id: "u1", sender_type: "User", message: "Who argues what?" },
    ]),
  );
  expect(s.conversations.get("c1")).toEqual([
    { id: "u1", user: "Who argues what?", answer: "Two camps.", thinking: null, live: false },
  ]);
  s = applyCapture(s, line({ conversationId: "c1", userChatItemId: "u2" }));
  s = applyCapture(s, line({ result: { message: "Thinking", isThinking: true } }));
  s = applyCapture(s, line({ result: { message: "Replies ", isThinking: false } }));
  expect(s.conversations.get("c1")?.at(-1)).toMatchObject({
    answer: "Replies ",
    thinking: "Thinking",
    live: true,
  });
  s = applyCapture(s, line({ result: { message: "split." } }));
  s = applyCapture(s, { kind: "end", stream: "1" });
  expect(s.conversations.get("c1")?.at(-1)).toMatchObject({
    answer: "Replies split.",
    live: false,
  });
  expect(s.streaming).toBeNull();
});

it("draws X's markdown answer as blocks: headings, lists, bold, links and code", () => {
  expect(
    markdownBlocks(
      "## For two plans\n- **Less** to compare, says [Jon](https://x.com/jonpark)\n```ts\nx\n```\nDone.",
    ),
  ).toEqual([
    {
      kind: "h",
      level: 2,
      runs: [{ text: "For two plans", bold: false, italic: false, code: false, href: null }],
    },
    {
      kind: "li",
      ordered: false,
      depth: 0,
      runs: [
        { text: "Less", bold: true, italic: false, code: false, href: null },
        { text: " to compare, says ", bold: false, italic: false, code: false, href: null },
        { text: "Jon", bold: false, italic: false, code: false, href: "https://x.com/jonpark" },
      ],
    },
    { kind: "code", lang: "ts", text: "x" },
    { kind: "p", runs: [{ text: "Done.", bold: false, italic: false, code: false, href: null }] },
  ]);
});

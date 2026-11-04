import { expect, it } from "vite-plus/test";

import {
  applyCapture,
  askLegacy,
  emptyLegacy,
  type GrokLegacyState,
  markdownBlocks,
  openChat,
  turnsOf,
} from "./grokLegacy";

const items = (restId: string, list: ReadonlyArray<Record<string, unknown>>) =>
  ({
    kind: "graphql",
    op: "GrokConversationItemsByRestId",
    variables: { restId },
    body: { data: { grok_conversation_items_by_rest_id: { items: list } } },
  }) as const;
const line = (value: unknown, stream = "1") =>
  ({ kind: "chunk", stream, line: JSON.stringify(value) }) as const;

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
  expect(turnsOf(s, "c1").at(-1)).toMatchObject({
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
  expect(s.streams.size).toBe(0);
});

it("keeps two of X's streams apart: each one's words and end reach only its own turn", () => {
  let s = applyCapture(emptyLegacy, line({ conversationId: "c1", userChatItemId: "ua" }, "A"));
  s = applyCapture(s, line({ conversationId: "c2", userChatItemId: "ub" }, "B"));
  s = applyCapture(s, line({ result: { message: "for A" } }, "A"));
  s = applyCapture(s, line({ result: { message: "for B" } }, "B"));
  s = applyCapture(s, { kind: "end", stream: "A" });
  expect(turnsOf(s, "c1")).toMatchObject([{ id: "ua", answer: "for A", live: false }]);
  expect(turnsOf(s, "c2")).toMatchObject([{ id: "ub", answer: "for B", live: true }]);
});

it("gives the question the user sent to the turn X's stream confirms, until X's items say otherwise", () => {
  let s = applyCapture(
    { ...emptyLegacy, asked: new Map([["c1", "And who is right?"]]) },
    line({ conversationId: "c1", userChatItemId: "u2" }),
  );
  s = applyCapture(s, line({ result: { message: "Neither." } }));
  expect(turnsOf(s, "c1")).toEqual([
    { id: "u2", user: "And who is right?", answer: "Neither.", thinking: null, live: true },
  ]);
  expect(s.asked.size).toBe(0);
  // X's items from before the question keep the turn still streaming.
  s = applyCapture(s, items("c1", [{ chat_item_id: "u1", sender_type: "User", message: "Hi" }]));
  expect(turnsOf(s, "c1").map((t) => [t.id, t.user])).toEqual([
    ["u1", "Hi"],
    ["u2", "And who is right?"],
  ]);
  // Once streamed, X's own items are the conversation.
  s = applyCapture(s, { kind: "end", stream: "1" });
  s = applyCapture(
    s,
    items("c1", [
      { chat_item_id: "a2", sender_type: "Agent", message: "Neither." },
      { chat_item_id: "u2", sender_type: "User", message: "And who is right? " },
    ]),
  );
  expect(s.conversations.get("c1")).toEqual([
    { id: "u2", user: "And who is right? ", answer: "Neither.", thinking: null, live: false },
  ]);
});

it("gives each question to the stream X's ask names its chat in, whichever starts first", () => {
  let s: GrokLegacyState = {
    ...emptyLegacy,
    asked: new Map([
      ["c1", "A"],
      ["c2", "B"],
    ]),
  };
  s = applyCapture(s, { kind: "start", stream: "1", conversation: "c1" });
  s = applyCapture(s, { kind: "start", stream: "2", conversation: "c2" });
  // X's first lines name the user's item, not the conversation.
  for (const stream of ["2", "1"])
    s = applyCapture(s, line({ userChatItemId: `u${stream}`, agentChatItemId: "a" }, stream));
  expect([turnsOf(s, "c1"), turnsOf(s, "c2")]).toMatchObject([
    [{ id: "u1", user: "A" }],
    [{ id: "u2", user: "B" }],
  ]);
});

it("gives the new chat's one question to the first new chat's stream, of either kind, once", () => {
  const created = (id: string) =>
    ({
      kind: "graphql",
      op: "CreateGrokConversation",
      variables: {},
      body: { data: { create_grok_conversation: { conversation_id: id } } },
    }) as const;
  const answer = (s: GrokLegacyState, stream: string, conversation: string | null) =>
    applyCapture(
      applyCapture(s, { kind: "start", stream, conversation }),
      line({ userChatItemId: `u${stream}`, conversationId: `c${stream}` }, stream),
    );
  // An ask naming no chat takes it.
  let s = answer(askLegacy(emptyLegacy, null, "A"), "1", null);
  s = answer(s, "2", null);
  // So does the conversation X just created, but not an old chat resumed meanwhile.
  s = applyCapture(askLegacy(s, null, "B"), created("c4"));
  s = answer(s, "3", "c-old");
  s = answer(s, "4", "c4");
  s = answer(applyCapture(s, created("c5")), "5", "c5");
  expect(["c1", "c2", "c-old", "c4", "c5"].map((c) => turnsOf(s, c)[0]?.user)).toEqual([
    "A",
    null,
    null,
    "B",
    null,
  ]);
  expect(s.fresh).toBeNull();
});

it("goes on from the part of an answer X's items hold when X resumes its stream", () => {
  let s = applyCapture(
    emptyLegacy,
    items("c1", [
      { chat_item_id: "a1", sender_type: "Agent", message: "Existing prefix ", is_partial: true },
      { chat_item_id: "u1", sender_type: "User", message: "Q" },
    ]),
  );
  s = applyCapture(s, { kind: "start", stream: "1", conversation: "c1" });
  s = applyCapture(s, line({ userChatItemId: "u1", agentChatItemId: "a1" }));
  s = applyCapture(s, line({ result: { message: "new suffix" } }));
  expect(turnsOf(s, "c1")).toEqual([
    { id: "u1", user: "Q", answer: "Existing prefix new suffix", thinking: null, live: true },
  ]);
});

it("keeps the chat on screen however many others X loads, and opening one makes it the latest", () => {
  let s = emptyLegacy;
  for (let i = 1; i <= 20; i++)
    s = applyCapture(
      s,
      items(`c${i}`, [{ chat_item_id: "u", sender_type: "User", message: `q${i}` }]),
    );
  s = openChat(s, "c1");
  expect([...s.conversations.keys()].at(-1)).toBe("c1");
  for (let i = 21; i <= 45; i++) s = applyCapture(s, items(`c${i}`, []));
  expect(turnsOf(s, "c1")).toMatchObject([{ user: "q1" }]);
  expect(s.conversations.size).toBe(20);
});

it("keeps the last 20 conversations and the one X streams in, and a streamed word copies none of them", () => {
  let s = applyCapture(
    emptyLegacy,
    items("c0", [{ chat_item_id: "u", sender_type: "User", message: "q" }]),
  );
  s = applyCapture(s, { kind: "start", stream: "1", conversation: "c0" });
  s = applyCapture(s, line({ userChatItemId: "u0" }));
  for (let i = 1; i <= 25; i++) s = applyCapture(s, items(`c${i}`, []));
  expect([...s.conversations.keys()]).toEqual([
    "c0",
    ...Array.from({ length: 19 }, (_, i) => `c${i + 7}`),
  ]);
  const before = s.conversations;
  s = applyCapture(s, line({ result: { message: "word" } }));
  expect(s.conversations).toBe(before);
  expect(turnsOf(s, "c0").at(-1)).toMatchObject({ id: "u0", answer: "word", live: true });
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

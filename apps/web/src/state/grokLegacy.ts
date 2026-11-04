import type { GrokCapture } from "@xtend/contracts";
import * as Atom from "effect/reactivity/Atom";

import type { GrokBlock, GrokRun } from "./grok";
import { xPressOver } from "./x";

/**
 * X's older Grok client (bundle.Grok), read from X's own answers the capture hands the window
 * (`GrokCapture`): its history, each conversation's items and the answer X streams. In memory
 * only, like Chat's: never the service, a log or an observation.
 */

interface LegacyRow {
  readonly id: string;
  readonly title: string;
  readonly at: number;
  readonly pinned: boolean;
}
interface LegacyTurn {
  readonly id: string;
  readonly user: string | null;
  /** Grok's answer as X's markdown; null while X has not answered. */
  readonly answer: string | null;
  readonly thinking: string | null;
  /** X is still streaming it. */
  readonly live: boolean;
}
/** One of X's answers in flight, kept apart from the conversations so each word copies only this. */
interface LegacyStream {
  /** The conversation X's ask named, else X's first line; null until either did. */
  readonly conversation: string | null;
  /** The turn it answers, from X's first line on. */
  readonly turn: LegacyTurn | null;
}
export interface GrokLegacyState {
  readonly history: ReadonlyArray<LegacyRow> | null;
  readonly pinned: ReadonlyArray<string>;
  /** The conversations X's items or finished answers last touched, oldest first, `KEEP` at most. */
  readonly conversations: ReadonlyMap<string, ReadonlyArray<LegacyTurn>>;
  /** X's streams in flight, by the capture's stream id. */
  readonly streams: ReadonlyMap<string, LegacyStream>;
  /** What the user asked through Xtend's box, by the chat it was asked in ("" for a new chat). */
  readonly asked: ReadonlyMap<string, string>;
}
export const emptyLegacy: GrokLegacyState = {
  history: null,
  pinned: [],
  conversations: new Map(),
  streams: new Map(),
  asked: new Map(),
};
const KEEP = 20;
export const grokLegacyAtom = Atom.make(emptyLegacy).pipe(Atom.keepAlive);

const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const list = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** X's conversation id on one of its items: `grokConversation.rest_id`, else `.id`. */
const conversationOf = (item: Record<string, unknown>) => {
  const c = record(item.grokConversation);
  return str(c.rest_id) ?? str(c.id);
};

/** The window's copy after one capture: a GraphQL answer, or a line or the end of X's stream. */
export const applyCapture = (state: GrokLegacyState, capture: GrokCapture): GrokLegacyState => {
  if (capture.kind === "graphql") {
    const data = record(record(capture.body).data);
    if (capture.op === "GrokHistory") {
      const rows = list(record(data.grok_conversation_history).items).flatMap((raw) => {
        const item = record(raw);
        const id = conversationOf(item);
        return id === null
          ? []
          : [
              {
                id,
                title: str(item.title) ?? "",
                at: Number(item.created_at_ms) || 0,
                pinned: false,
              },
            ];
      });
      return {
        ...state,
        history: rows.map((r) => ({ ...r, pinned: state.pinned.includes(r.id) })),
      };
    }
    if (capture.op === "GrokPinnedConversations") {
      const pinned = list(record(data.grok_pinned_conversations).items).flatMap((raw) => {
        const id = conversationOf(record(raw));
        return id === null ? [] : [id];
      });
      return {
        ...state,
        pinned,
        history: state.history?.map((r) => ({ ...r, pinned: pinned.includes(r.id) })) ?? null,
      };
    }
    const id = str(record(capture.variables).restId);
    if (capture.op !== "GrokConversationItemsByRestId" || id === null) return state;
    // X lists a conversation's items newest first.
    const items = [...list(record(data.grok_conversation_items_by_rest_id).items)].reverse();
    const turns: Array<LegacyTurn> = [];
    for (const raw of items) {
      const item = record(raw);
      const text = str(item.message) ?? "";
      if (item.sender_type === "User")
        turns.push({
          id: str(item.chat_item_id) ?? String(turns.length),
          user: text,
          answer: null,
          thinking: null,
          live: false,
        });
      else if (item.sender_type === "Agent") {
        const last = turns.at(-1);
        const answer = {
          answer: text,
          thinking: str(item.thinking_trace),
          live: item.is_partial === true,
        };
        if (last !== undefined && last.answer === null)
          turns[turns.length - 1] = { ...last, ...answer };
        else
          turns.push({ id: str(item.chat_item_id) ?? String(turns.length), user: null, ...answer });
      }
    }
    return { ...state, conversations: remember(state, id, turns) };
  }
  const stream = state.streams.get(capture.stream);
  if (capture.kind === "start")
    return {
      ...state,
      streams: new Map(state.streams).set(capture.stream, {
        conversation: capture.conversation,
        turn: null,
      }),
    };
  if (capture.kind === "end") {
    if (stream === undefined) return state;
    const streams = new Map(state.streams);
    streams.delete(capture.stream);
    if (stream.conversation === null || stream.turn === null) return { ...state, streams };
    const done = { ...stream.turn, live: false };
    const turns = state.conversations.get(stream.conversation) ?? [];
    const at = turns.findIndex((t) => t.id === done.id);
    const next =
      at === -1
        ? [...turns, done]
        : turns.with(at, { ...done, user: turns[at]!.user ?? done.user });
    return {
      ...state,
      streams,
      conversations: remember({ ...state, streams }, stream.conversation, next),
    };
  }
  let line: Record<string, unknown>;
  try {
    line = record(JSON.parse(capture.line));
  } catch {
    return state;
  }
  const conversation = stream?.conversation ?? str(line.conversationId);
  if (conversation === null) return state;
  let asked = state.asked;
  let turn = stream?.turn ?? null;
  if (turn === null) {
    // X's first line names the user's item; its question is the one asked in this chat, or in a
    // new chat when X's conversation is one Xtend has not seen.
    const key = asked.has(conversation)
      ? conversation
      : asked.has("") && !state.conversations.has(conversation)
        ? ""
        : null;
    if (key !== null) {
      const rest = new Map(asked);
      rest.delete(key);
      asked = rest;
    }
    const id = str(line.userChatItemId) ?? `live-${capture.stream}`;
    turn = {
      id,
      user: key === null ? null : state.asked.get(key)!,
      answer: null,
      thinking: null,
      live: true,
    };
  }
  const result = record(line.result);
  const token = str(result.message);
  if (token !== null)
    turn =
      result.isThinking === true
        ? { ...turn, thinking: (turn.thinking ?? "") + token }
        : { ...turn, answer: (turn.answer ?? "") + token };
  return {
    ...state,
    asked,
    streams: new Map(state.streams).set(capture.stream, { conversation, turn }),
  };
};

/**
 * `conversations` with `id` set to `turns` as the latest touched, less the oldest beyond `KEEP`
 * that no stream in flight answers in.
 */
const remember = (
  state: Pick<GrokLegacyState, "conversations" | "streams">,
  id: string,
  turns: ReadonlyArray<LegacyTurn>,
) => {
  const next = new Map(state.conversations);
  next.delete(id);
  next.set(id, turns);
  const live = new Set([...state.streams.values()].map((s) => s.conversation));
  for (const key of next.keys()) {
    if (next.size <= KEEP) break;
    if (!live.has(key)) next.delete(key);
  }
  return next;
};

/** Conversation `chat`'s turns as X's items list them, with the answers X is streaming in it. */
export const turnsOf = (state: GrokLegacyState, chat: string): ReadonlyArray<LegacyTurn> => {
  const turns = [...(state.conversations.get(chat) ?? [])];
  for (const s of state.streams.values()) {
    if (s.conversation !== chat || s.turn === null) continue;
    const at = turns.findIndex((t) => t.id === s.turn!.id);
    // X's items fill in the question; the words streamed so far are the answer's.
    if (at === -1) turns.push(s.turn);
    else turns[at] = { ...s.turn, user: turns[at]!.user ?? s.turn.user };
  }
  return turns;
};

/** X's inline markdown as runs: **bold**, *italic*, `code` and [links](url). */
const inline = (text: string): ReadonlyArray<GrokRun> => {
  const runs: Array<GrokRun> = [];
  const plain = { bold: false, italic: false, code: false, href: null };
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) runs.push({ ...plain, text: text.slice(at, m.index) });
    if (m[1] !== undefined) runs.push({ ...plain, text: m[1], bold: true });
    else if (m[2] !== undefined) runs.push({ ...plain, text: m[2], italic: true });
    else if (m[3] !== undefined) runs.push({ ...plain, text: m[3], code: true });
    else runs.push({ ...plain, text: m[4]!, href: m[5]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ ...plain, text: text.slice(at) });
  return runs;
};

/** X's markdown answer as the blocks Xtend's Grok draws: headings, lists, code, paragraphs. */
export const markdownBlocks = (markdown: string): ReadonlyArray<GrokBlock> => {
  const out: Array<GrokBlock> = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: Array<string> = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      out.push({ kind: "code", lang: line.slice(3).trim(), text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (heading !== null)
      out.push({ kind: "h", level: heading[1]!.length, runs: inline(heading[2]!) });
    else if (item !== null)
      out.push({
        kind: "li",
        ordered: /\d/.test(item[2]!),
        depth: Math.floor(item[1]!.length / 2),
        runs: inline(item[3]!),
      });
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) out.push({ kind: "hr" });
    else if (line.startsWith(">"))
      out.push({ kind: "quote", runs: inline(line.replace(/^>\s?/, "")) });
    else if (line.trim() !== "") out.push({ kind: "p", runs: inline(line) });
  }
  return out;
};

/** Follows X's older Grok client's traffic into `set` until the returned stop is called. */
export const listenGrokLegacy = (set: (f: (s: GrokLegacyState) => GrokLegacyState) => void) =>
  window.desktopBridge?.onGrok?.((capture) => set((s) => applyCapture(s, capture))) ?? (() => {});

/**
 * Asks Grok `text` in X's older client for the user's click: typed into X's own "Ask anything"
 * box, then X's own Send by its English label. "sent", "pending", "draft" (X's box holds the
 * user's words) or "unlabelled" (no Send Xtend knows); null when X draws no older client here, or
 * the chat, X's box or its words changed before Send was ready (nothing pressed).
 */
export const xGrokLegacySend = async (text: string) => {
  const answer = await xPressOver(
    (mine) => `(async () => {
    const wait = async (check, tries) => { for (let i = 0; i < tries; i++) { const f = check(); if (f) return f; await new Promise((r) => setTimeout(r, 100)); } return check(); };
    const onGrok = location.pathname === "/i/grok" || location.pathname.startsWith("/i/grok/");
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const field = column?.querySelector('textarea[placeholder="Ask anything"]') ?? null;
    if (!onGrok || !field || document.querySelector("fieldset[data-grok-composer]") || !${mine}) return null;
    if (field.value.trim() !== "") return "draft";
    const at = location.pathname + location.search;
    const labels = ["Grok something", "Send"];
    const send = () => [...column.querySelectorAll('button, [role="button"]')].find((b) => labels.includes(b.getAttribute("aria-label") ?? "") && !b.disabled && b.getAttribute("aria-disabled") !== "true") ?? null;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const button = await wait(send, 20);
    if (!button || !${mine}) return "unlabelled";
    // The user opened another chat, or X redrew or changed its box, while X readied Send.
    if (location.pathname + location.search !== at || !field.isConnected || column.querySelector('textarea[placeholder="Ask anything"]') !== field || field.value !== ${JSON.stringify(text)}) return null;
    button.click();
    return (await wait(() => field.value === "", 50)) ? "sent" : "pending";
  })()`,
    "false",
    () => {},
  );
  return answer === "sent" || answer === "pending" || answer === "draft" || answer === "unlabelled"
    ? answer
    : null;
};

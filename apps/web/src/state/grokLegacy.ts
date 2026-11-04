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
export interface GrokLegacyState {
  readonly history: ReadonlyArray<LegacyRow> | null;
  readonly pinned: ReadonlyArray<string>;
  readonly conversations: ReadonlyMap<string, ReadonlyArray<LegacyTurn>>;
  /** The conversation X's stream answers in, once X said which. */
  readonly streaming: string | null;
}
export const emptyLegacy: GrokLegacyState = {
  history: null,
  pinned: [],
  conversations: new Map(),
  streaming: null,
};
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
    return { ...state, conversations: new Map(state.conversations).set(id, turns) };
  }
  const id = state.streaming;
  if (capture.kind === "end") {
    if (id === null) return state;
    const turns = (state.conversations.get(id) ?? []).map((t) =>
      t.live ? { ...t, live: false } : t,
    );
    return {
      ...state,
      streaming: null,
      conversations: new Map(state.conversations).set(id, turns),
    };
  }
  let line: Record<string, unknown>;
  try {
    line = record(JSON.parse(capture.line));
  } catch {
    return state;
  }
  // X's first line names the conversation the answer belongs to.
  const named = str(line.conversationId);
  if (named !== null) return { ...state, streaming: named };
  const result = record(line.result);
  const token = str(result.message);
  if (id === null || token === null) return state;
  const turns = [...(state.conversations.get(id) ?? [])];
  const last = turns.at(-1);
  const into =
    last?.live === true
      ? last
      : { id: `live-${turns.length}`, user: null, answer: null, thinking: null, live: true };
  const next =
    result.isThinking === true
      ? { ...into, thinking: (into.thinking ?? "") + token }
      : { ...into, answer: (into.answer ?? "") + token };
  if (last?.live === true) turns[turns.length - 1] = next;
  else turns.push(next);
  return { ...state, conversations: new Map(state.conversations).set(id, turns) };
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
 * user's words) or "unlabelled" (no Send Xtend knows); null when X draws no older client here.
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
    const labels = ["Grok something", "Send"];
    const send = () => [...column.querySelectorAll('button, [role="button"]')].find((b) => labels.includes(b.getAttribute("aria-label") ?? "") && !b.disabled && b.getAttribute("aria-disabled") !== "true") ?? null;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${JSON.stringify(text)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const button = await wait(send, 20);
    if (!button || !${mine}) return "unlabelled";
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

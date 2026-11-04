import { useAtom, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { GrokRead } from "../../state/grok";
import {
  askLegacy,
  grokLegacyAtom,
  markdownBlocks,
  openChat,
  settleLegacy,
  turnsOf,
  unaskLegacy,
  xGrokLegacySend,
} from "../../state/grokLegacy";
import { xGo, xUrlAtom } from "../../state/x";
import { GrokConversation, useGrokPress } from "./Grok";

/**
 * X's older Grok client (bundle.Grok) drawn by Xtend from X's own answers: the conversation X's
 * page shows, its streamed answer word by word, and a box that sends through X's own. Its other
 * controls stay X's, on X's page.
 */
export function GrokLegacy() {
  const navigate = useNavigate();
  const [legacy, setLegacy] = useAtom(grokLegacyAtom);
  const url = useAtomValue(xUrlAtom);
  const { press, setToast } = useGrokPress();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Read by the effects below, which must not rerun when a Send starts or settles.
  const sendingRef = useRef(false);
  let chat: string | null = null;
  try {
    chat = new URL(url).searchParams.get("conversation");
  } catch {}
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- marks the chat X's page shows as the one on screen while it is, so the store keeps it.
  useEffect(() => {
    // Another chat opened: a new chat's question no stream took is dropped, unless this is the
    // chat X just created for it.
    setLegacy((s) =>
      openChat(sendingRef.current || chat === s.created ? s : settleLegacy(s), chat),
    );
    return () => setLegacy((s) => (s.open === chat ? openChat(s, null) : s));
  }, [chat, setLegacy]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- drops a new chat's question no stream took when the user leaves Grok.
  useEffect(
    () => () => {
      if (!sendingRef.current) setLegacy(settleLegacy);
    },
    [setLegacy],
  );
  const turns = chat === null ? [] : turnsOf(legacy, chat);
  const live = turns.some((t) => t.live);
  // One new chat at a time: its question waits for X's stream to say which chat it started.
  const waiting = chat === null && legacy.fresh !== null;
  // The same conversation Xtend draws for X's newer client, from X's markdown.
  const read: GrokRead = {
    path: "/i/grok",
    page: "xweb",
    followUps: [],
    alert: null,
    composer: null,
    model: null,
    private: null,
    conversation: chat !== null,
    chat,
    turns: turns.map((t) => ({
      id: t.id,
      user: t.user,
      answer:
        t.answer === null && t.thinking === null
          ? null
          : {
              id: `a-${t.id}`,
              trace: t.live && t.answer === null ? "Thinking" : null,
              blocks: markdownBlocks(t.answer ?? ""),
              sources: null,
              done: false,
              feedback: null,
              regenerate: false,
            },
    })),
  };
  const send = async () => {
    const text = draft;
    if (text.trim() === "" || sending || live || waiting) return;
    setSending(true);
    sendingRef.current = true;
    // X's stream names the turn but not the question: its turn in this chat takes these words.
    setLegacy((s) => askLegacy(s, chat, text));
    const sent = await press(() => xGrokLegacySend(text));
    sendingRef.current = false;
    setSending(false);
    if (sent !== "sent" && sent !== "pending") setLegacy((s) => unaskLegacy(s, chat, text));
    if (sent === "sent") setDraft("");
    if (sent === "draft") setToast({ text: "X's Grok box holds a draft; finish it in X." });
    // X draws no Send Xtend knows here: the words wait in X's own box, on X's page.
    if (sent === "unlabelled") void navigate({ to: "/x" });
  };
  return (
    <>
      <div className="drag-region flex min-h-[53px] items-center gap-2 px-3">
        <span className="flex-1 text-[15px] font-bold">Grok</span>
        <button
          type="button"
          className="no-drag h-8 cursor-pointer rounded-full border border-white/[0.18] px-3 text-[13px] font-bold hover:bg-white/[0.06]"
          onClick={() => void navigate({ to: "/x" })}
        >
          Open in X
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <GrokConversation read={read} />
      </div>
      {waiting ? (
        <p className="px-4 pt-2 text-[13px] text-[#71767b]">
          Waiting for Grok to start the last chat
        </p>
      ) : null}
      <div className="flex items-end gap-2 px-4 pt-2 pb-4">
        <textarea
          aria-label="Ask Grok"
          placeholder="Ask anything"
          rows={1}
          value={draft}
          disabled={sending}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-3xl border border-white/[0.16] bg-black px-4 py-2 text-[15px] outline-hidden [field-sizing:content] placeholder:text-[#71767b]"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
        />
        <button
          type="button"
          disabled={draft.trim() === "" || sending || live || waiting}
          className="h-10 shrink-0 cursor-pointer rounded-full bg-foreground px-4 text-[14px] font-bold text-background disabled:cursor-default disabled:opacity-40"
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </>
  );
}

/** X's older client's history in the rail, from X's own GrokHistory: one click opens a chat in X. */
export function GrokLegacyHistory() {
  const legacy = useAtomValue(grokLegacyAtom);
  const rows = legacy.history;
  return (
    <section
      aria-label="History"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3"
    >
      {rows === null ? (
        <p className="px-2 py-6 text-center text-[13px] text-[#71767b]">
          Your history shows once X loads it: open Chat history in X.
        </p>
      ) : (
        <ul>
          {[...rows]
            .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at - a.at)
            .map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-x="grok-history-row"
                  className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-[15px] hover:bg-white/[0.04]"
                  onClick={() =>
                    void xGo(`https://x.com/i/grok?conversation=${encodeURIComponent(row.id)}`)
                  }
                >
                  <span className="truncate">{row.title || "Untitled chat"}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

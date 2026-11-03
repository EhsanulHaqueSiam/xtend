import { useAtom, useAtomSet } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { BellOff, ImageIcon, Mail, Pin, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { Empty } from "../components/ui/layout";
import { XEmpty } from "../components/xnative/XRows";
import { Avatar } from "../components/xnative/XPostView";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import {
  type ChatItem,
  type ChatRow,
  chatAtom,
  isChatPath,
  mergeChat,
  watchChat,
  xChatScroll,
  xChatSearch,
} from "../state/chat";
import { isXRoute, xGo, xLeave, xNavigate, xOverAtom } from "../state/x";

type Tab = "all" | "requests" | "other";
/** X's page for each list: the inbox, its message requests, and the requests X files as Other. */
const LIST_PATH: Readonly<Record<Tab, string>> = {
  all: "/i/chat",
  requests: "/i/chat/requests",
  other: "/i/chat/requests/other",
};
const CHIPS = [
  { id: "all", label: "All" },
  { id: "requests", label: "Requests" },
] as const;

/** Faces as X draws them: one, or a group's first two overlapping. */
function Faces({ urls, size }: { readonly urls: ReadonlyArray<string>; readonly size: number }) {
  const shown = urls.filter((u) => u.startsWith("https://") || u.startsWith("data:image/"));
  if (shown.length < 2) return <Avatar url={shown[0] ?? null} size={size} />;
  const small = Math.round(size * 0.7);
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      <span className="absolute top-0 right-0">
        <Avatar url={shown[1]!} size={small} />
      </span>
      <span className="absolute bottom-0 left-0 rounded-full ring-2 ring-black">
        <Avatar url={shown[0]!} size={small} />
      </span>
    </span>
  );
}

/** A conversation as X's inbox lists it: face, name and time over the last message, and its marks. */
function Row({
  row,
  selected,
  onOpen,
}: {
  readonly row: ChatRow;
  readonly selected: boolean;
  readonly onOpen: (row: ChatRow) => void;
}) {
  return (
    <button
      type="button"
      data-x="chat-row"
      aria-current={selected || undefined}
      className="mx-2 flex w-[calc(100%-16px)] cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors duration-150 hover:bg-white/[0.04] aria-[current=true]:bg-white/[0.08]"
      onClick={() => onOpen(row)}
    >
      <Faces urls={row.avatars} size={48} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[15px]">
          <b className="min-w-0 flex-1 truncate font-bold">{row.name}</b>
          {row.pinned ? <Pin aria-label="Pinned" className="size-3.5 text-[#71767b]" /> : null}
          <span className={cn("shrink-0 text-[13px]", row.unread ? "font-bold" : "text-[#71767b]")}>
            {row.time}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[15px]">
          <span
            className={cn("min-w-0 flex-1 truncate", row.unread ? "font-medium" : "text-[#71767b]")}
          >
            {row.preview}
          </span>
          {row.muted ? <BellOff aria-label="Muted" className="size-3.5 text-[#71767b]" /> : null}
          {row.unread ? (
            <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-[#1d9bf0]" />
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A message as X draws it: yours on the right in blue, theirs on the left, reactions under it. */
function Item({ item, group }: { readonly item: ChatItem; readonly group: boolean }) {
  if (item.kind === "info")
    return <p className="px-4 py-2 text-center text-[13px] text-[#71767b]">{item.text}</p>;
  return (
    <div
      data-x="chat-message"
      className={cn("flex flex-col px-4 py-0.5", item.mine ? "items-end" : "items-start")}
    >
      {group && !item.mine ? (
        <span className="px-3 pt-2 text-[13px] text-[#71767b]">{item.sender}</span>
      ) : null}
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-1 rounded-3xl px-4 py-2.5 text-[15px] leading-5 break-words whitespace-pre-wrap",
          item.mine ? "bg-[#1d9bf0] text-white" : "bg-[#2f3336]",
        )}
      >
        {item.media === null ? null : (
          <span className="flex items-center gap-1.5 opacity-80">
            <ImageIcon className="size-4" />
            {item.media}
          </span>
        )}
        {item.text === "" ? null : <span>{item.text}</span>}
        {item.time === null ? null : (
          <span
            className={cn("self-end text-[11px]", item.mine ? "text-white/70" : "text-[#71767b]")}
          >
            {item.time}
          </span>
        )}
      </div>
      {item.reactions.length === 0 ? null : (
        <span className="-mt-1 flex gap-1">
          {item.reactions.map((r) => (
            <span
              key={r.emoji}
              className="rounded-full border border-black bg-[#2f3336] px-2 text-[13px] leading-5"
            >
              {r.emoji}
              {r.count > 1 ? ` ${r.count}` : ""}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * X's Chat, drawn by Xtend from X's own page: the inbox, its message requests and, once clicked,
 * a conversation. X opens a conversation only for the user's click on its row, since opening one
 * marks it read. Read only: replies happen in X's page (Open in X).
 */
function ChatScreen() {
  const { tab, c } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [chat, setChat] = useAtom(chatAtom);
  const setOver = useAtomSet(xOverAtom);
  const [query, setQuery] = useState("");
  const open = c !== undefined && isChatPath(c) ? c : null;
  // The conversation the user's click opened in X. X marks a conversation read once open, so one
  // the route brings back (a reload, Back, Forward) is never opened: X shows its list instead.
  const opened = useRef<string | null>(null);
  // Whether X's search holds a query Xtend typed, the only one Xtend may close.
  const typed = useRef(false);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to the X list this screen shows.
  useEffect(() => {
    if (open !== null && open === opened.current) return;
    opened.current = null;
    void xGo(`https://x.com${LIST_PATH[tab]}`);
  }, [open, tab]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's chat roots while this screen is open, and only then.
  useEffect(() => {
    if (!isElectron) return;
    const stop = new AbortController();
    watchChat(stop.signal, (read) => setChat((s) => mergeChat(s, read)));
    return () => {
      stop.abort();
      setChat((s) => ({ ...s, locked: false, search: null }));
    };
  }, [setChat]);
  // An open conversation keeps marking what arrives read in X: once the screen is gone, X leaves it.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- takes the engine off X's conversation when this screen lets it go.
  useEffect(() => {
    if (open === null) return;
    return () => xLeave(open, () => isXRoute(router.state.location.pathname));
  }, [open, router]);
  // X's passcode screen is X's to answer: it shows over the main area until X opens its chats.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- shows the engine over the main area while X asks for its passcode.
  useEffect(() => {
    setOver(chat.locked);
  }, [chat.locked, setOver]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- types the search into X's own chat search, a moment after the last key.
  useEffect(() => {
    const q = query.trim();
    if (q === "" && !typed.current) return;
    const timer = setTimeout(() => {
      typed.current = q !== "";
      void xChatSearch(q);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- closes the query Xtend typed into X's chat search when the screen goes.
  useEffect(
    () => () => {
      if (typed.current) void xChatSearch("");
    },
    [],
  );

  const inboxAsked = useRef(-1);
  const olderAsked = useRef(-1);
  if (!isElectron)
    return (
      <Empty>
        Chat needs the desktop app. X's chats are end-to-end encrypted, so they open only in X's own
        page, in your session.
      </Empty>
    );

  const openRow = (row: ChatRow) => {
    if (!isChatPath(row.href)) return;
    opened.current = row.href;
    void xGo(`https://x.com${row.href}`);
    // X is on its way there: the screen shows it opening until X's next read says where X is.
    setChat((s) => ({ ...s, path: row.href }));
    // A result opened ends the search, as X's conversation page has none to list it: the inbox
    // shows again, and X's query, Xtend's own, closes.
    setQuery("");
    void navigate({ to: "/chat", search: { tab, c: row.href } });
  };
  const searching = query.trim() !== "";
  const requests = chat.requests?.path === LIST_PATH[tab] ? chat.requests.rows : null;
  const rows = searching ? chat.search : tab === "all" ? chat.inbox : requests;
  // What Xtend read of it, or X opening it now; a conversation the route brought back shows no more.
  const conversation = chat.conversation?.path === open ? chat.conversation : null;
  const shown = open !== null && (conversation !== null || chat.path === open);
  const head = chat.inbox?.find((r) => r.href === open) ?? requests?.find((r) => r.href === open);
  const group = head?.group ?? open?.split("/").at(-1)?.startsWith("g") ?? false;

  return (
    <div className="flex h-full min-h-0 bg-black">
      <section
        aria-label="Chats"
        className="flex w-[400px] min-w-[320px] shrink-0 flex-col border-r border-border"
      >
        <div className="drag-region flex min-h-[53px] items-center px-4">
          <h1 className="text-[20px] font-bold">Chat</h1>
        </div>
        <label className="no-drag mx-4 mb-3 flex h-10 items-center gap-2 rounded-full bg-[#202327] px-4 focus-within:ring-1 focus-within:ring-[#1d9bf0] focus-within:ring-inset">
          <Search className="size-4 text-[#71767b]" />
          <input
            aria-label="Search"
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div role="tablist" aria-label="Chat" className="no-drag flex gap-2 px-4 pb-2">
          {CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={chip.id === "requests" ? tab !== "all" : tab === "all"}
              className="cursor-pointer rounded-full border border-white/[0.18] px-3 py-1 text-[13px] font-bold text-[#71767b] aria-selected:border-transparent aria-selected:bg-white aria-selected:text-black"
              onClick={() => void navigate({ to: "/chat", search: { tab: chip.id } })}
            >
              {chip.label}
            </button>
          ))}
          {tab === "all" ? null : (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "other"}
              className="ml-auto cursor-pointer rounded-full border border-white/[0.18] px-3 py-1 text-[13px] font-bold text-[#71767b] aria-selected:border-transparent aria-selected:bg-white aria-selected:text-black"
              onClick={() => void navigate({ to: "/chat", search: { tab: "other" } })}
            >
              Other
            </button>
          )}
        </div>
        {tab === "other" ? (
          <p className="px-4 pb-2 text-[13px] text-[#71767b]">
            These message requests may be spam or lower priority.
          </p>
        ) : null}
        {tab === "all" && !searching && chat.requestsRow !== null ? (
          <button
            type="button"
            className="mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-white/[0.04]"
            onClick={() => void navigate({ to: "/chat", search: { tab: "requests" } })}
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white/[0.08]">
              <Mail className="size-6" />
            </span>
            <span className="min-w-0 flex-1 text-[15px]">
              <b className="block font-bold">Message Requests</b>
              <span className="block truncate text-[#71767b]">{chat.requestsRow.summary}</span>
            </span>
            {chat.requestsRow.unread ? (
              <span aria-label="Unread" className="size-2 rounded-full bg-[#1d9bf0]" />
            ) : null}
          </button>
        ) : null}
        <div className="min-h-0 flex-1">
          {rows === null ? (
            <XEmpty
              key={`${tab}:${searching}`}
              empty={searching ? "Searching your chats in X." : "Loading your chats from X."}
              onReopen={() => void xNavigate(`https://x.com${LIST_PATH[tab]}`)}
            />
          ) : rows.length === 0 ? (
            <Empty>
              {searching
                ? "No chats match."
                : tab === "all"
                  ? "Empty inbox. Message someone in X."
                  : "No message requests."}
            </Empty>
          ) : (
            <Virtuoso
              style={{ height: "100%" }}
              data={rows}
              computeItemKey={(_, row) => row.id}
              endReached={() => {
                if (tab !== "all" || searching || inboxAsked.current === rows.length) return;
                inboxAsked.current = rows.length;
                void xChatScroll("inbox");
              }}
              itemContent={(_, row) => (
                <Row row={row} selected={row.href === open} onOpen={openRow} />
              )}
            />
          )}
        </div>
      </section>
      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
        {open === null || !shown ? (
          <div className="m-auto max-w-[340px] px-6">
            <h2 className="text-[31px] leading-9 font-extrabold">Select a message</h2>
            <p className="mt-2 text-[15px] text-[#71767b]">
              Choose from your existing conversations, or start a new one in X.
            </p>
          </div>
        ) : (
          <>
            <div className="drag-region flex min-h-[53px] items-center gap-3 border-b border-border px-4">
              {head === undefined ? null : <Faces urls={head.avatars} size={32} />}
              <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">
                {conversation?.title ?? head?.name ?? ""}
              </h2>
              <button
                type="button"
                className="no-drag h-8 cursor-pointer rounded-full border border-white/[0.18] px-3.5 text-[13px] font-bold hover:bg-white/[0.06]"
                onClick={() => void navigate({ to: "/x" })}
              >
                Open in X
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {conversation === null ? (
                <XEmpty
                  key={open}
                  empty="Opening the conversation in X."
                  onReopen={() => void xNavigate(`https://x.com${open}`)}
                />
              ) : (
                <Virtuoso
                  key={open}
                  style={{ height: "100%" }}
                  data={conversation.items}
                  firstItemIndex={conversation.first}
                  initialTopMostItemIndex={conversation.items.length - 1}
                  alignToBottom
                  followOutput={(atBottom) => (atBottom ? "auto" : false)}
                  computeItemKey={(_, item) => item.id}
                  startReached={() => {
                    if (olderAsked.current === conversation.first) return;
                    olderAsked.current = conversation.first;
                    void xChatScroll("messages");
                  }}
                  itemContent={(_, item) => <Item item={item} group={group} />}
                />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export const Route = createFileRoute("/chat")({
  validateSearch: (s: Record<string, unknown>): { tab: Tab; c?: string } => ({
    tab: s.tab === "requests" || s.tab === "other" ? s.tab : "all",
    ...(typeof s.c === "string" && isChatPath(s.c) ? { c: s.c } : {}),
  }),
  component: ChatScreen,
});

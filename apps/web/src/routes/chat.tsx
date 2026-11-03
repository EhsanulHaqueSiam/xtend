import { useAtom, useAtomSet } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  BellOff,
  ImageIcon,
  Mail,
  MoreHorizontal,
  Pin,
  Reply,
  Search,
  SmilePlus,
  SquarePen,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { Empty } from "../components/ui/layout";
import { Menu, MenuItem } from "../components/ui/menu";
import { Popover } from "../components/ui/popover";
import { useXPress } from "../components/xnative/useXPress";
import { XEmpty } from "../components/xnative/XRows";
import { Avatar } from "../components/xnative/XPostView";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import {
  type ChatDraft,
  type ChatItem,
  type ChatMenu,
  type ChatMessage,
  type ChatRow,
  type ChatState,
  chatAtom,
  chatWriteAtom,
  emptyDraft,
  endSend,
  isChatPath,
  mergeChat,
  sameWords,
  sendMark,
  watchChat,
  xChatEditText,
  xChatFirst,
  xChatInfo,
  xChatMenu,
  xChatMenuPress,
  xChatNew,
  xChatReact,
  xChatReactions,
  xChatRequest,
  xChatScroll,
  xChatSearch,
  xChatSend,
} from "../state/chat";
import { isXRoute, xGo, xLeave, xNavigate, xOverAtom, xRun } from "../state/x";

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

/**
 * A message as X draws it: yours on the right in blue, theirs on the left, reactions under it, and
 * X's hover bar (`actions`) beside it while the pointer is over it.
 */
function Item({
  item,
  group,
  actions,
}: {
  readonly item: ChatItem;
  readonly group: boolean;
  readonly actions?: ReactNode;
}) {
  if (item.kind === "info")
    return <p className="px-4 py-2 text-center text-[13px] text-[#71767b]">{item.text}</p>;
  const footer =
    item.status === "pending"
      ? "Sending…"
      : item.status === "failed"
        ? "Failed to send"
        : item.time;
  return (
    <div
      data-x="chat-message"
      className={cn("group flex flex-col px-4 py-0.5", item.mine ? "items-end" : "items-start")}
    >
      {group && !item.mine ? (
        <span className="px-3 pt-2 text-[13px] text-[#71767b]">{item.sender}</span>
      ) : null}
      <div className={cn("flex max-w-[75%] items-center gap-1", item.mine && "flex-row-reverse")}>
        <div
          className={cn(
            "flex min-w-0 flex-col gap-1 rounded-3xl px-4 py-2.5 text-[15px] leading-5 break-words whitespace-pre-wrap",
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
          {footer === null ? null : (
            <span
              className={cn(
                "self-end text-[11px]",
                item.status === "failed"
                  ? "font-bold text-[#f4212e]"
                  : item.mine
                    ? "text-white/70"
                    : "text-[#71767b]",
              )}
            >
              {footer}
            </span>
          )}
        </div>
        {actions}
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
 * Conversation `path`'s draft, kept by X's path while Xtend's screens come and go, and the one send
 * in flight in X's Chat, which holds every conversation's Send, Reply and Edit until it ends.
 */
function useDraft(path: string) {
  const [write, setWrite] = useAtom(chatWriteAtom);
  const setDraft = (draft: ChatDraft) =>
    setWrite((w) => ({ ...w, drafts: new Map(w.drafts).set(path, draft) }));
  return { draft: write.drafts.get(path) ?? emptyDraft, setDraft, send: write.send, setWrite };
}

/**
 * The user's click on one of X's own controls: only while Settings lets the session act, and X's
 * refusal (null) said as a toast. Resolves to X's answer, or null.
 */
function usePress() {
  const { blocked, setToast } = useXPress();
  const press = async <A,>(run: () => Promise<A | null>) => {
    const why = blocked();
    if (why !== null) return (setToast({ text: why }), null);
    const answer = await run();
    if (answer === null) setToast({ text: "X did not take that. Try again in a moment." });
    return answer;
  };
  return { press, setToast };
}

const DRAFT_HELD = "X's composer holds a draft; finish it in X.";

const ROUND =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-[#71767b] hover:bg-white/[0.08] hover:text-foreground";

/**
 * X's hover bar on a message, drawn by Xtend: React (X's own quick reactions), Reply and X's "..."
 * rows, each read from X's page when opened. Reply, Copy and Edit work in Xtend's composer (an
 * edit from the text X loads into its own editor); every other row is X's own, pressed for the
 * click, with what X asks next over the main area.
 */
function MessageActions({
  path,
  item,
  composer,
  known,
}: {
  readonly path: string;
  readonly item: ChatMessage;
  /** X draws its composer here, so the user can react and reply. */
  readonly composer: boolean;
  /** X's ids of the conversation's messages Xtend read. */
  readonly known: ReadonlyArray<string>;
}) {
  const setOver = useAtomSet(xOverAtom);
  const { press, setToast } = usePress();
  const { draft, setDraft, send } = useDraft(path);
  const reply = () => setDraft({ text: draft.text, mode: { kind: "reply", item } });
  const drafting = (icon: string) => icon === "icon-reply-arrow" || icon === "icon-pencil-stroke";
  const [menu, setMenu] = useState<ChatMenu | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [quick, setQuick] = useState<Awaited<ReturnType<typeof xChatReactions>> | undefined>(
    undefined,
  );
  const edit = async (label: string) => {
    const loaded = await press(() => xChatEditText(path, item.id, known));
    if (loaded === "draft") return setToast({ text: DRAFT_HELD });
    // X's editor could not be read: the edit is X's to take, on its own page over the main area.
    if (loaded === "unread") return void press(() => xChatMenuPress(path, item.id, label, setOver));
    if (loaded !== null)
      setDraft({ text: loaded.text, mode: { kind: "edit", item, old: loaded.text } });
  };
  const pick = ({ label, icon }: ChatMenu["rows"][number]) => {
    if (icon === "icon-reply-arrow") return reply();
    if (icon === "icon-pencil-stroke") return void edit(label);
    // X's own Copy writes the clipboard from the engine, off screen, which is not reliable.
    if (icon === "icon-clone" || icon === "icon-link")
      return void navigator.clipboard
        .writeText(item.text)
        .then(() => setToast({ text: "Copied to clipboard" }));
    void press(() => xChatMenuPress(path, item.id, label, setOver));
  };
  return (
    <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-aria-expanded:opacity-100">
      {composer && item.status === "sent" ? (
        <>
          <Popover
            open={picking}
            onOpenChange={(open) => {
              setPicking(open);
              if (!open) return;
              setQuick(undefined);
              void xChatReactions(path, item.id).then(setQuick);
            }}
            align="center"
            className="w-auto p-1.5"
            trigger={
              <button type="button" aria-label="React" className={ROUND}>
                <SmilePlus className="size-4" />
              </button>
            }
          >
            {quick === undefined || quick === null ? (
              <p className="px-2 py-1 text-[#71767b]">
                {quick === undefined ? "Loading from X" : "X offers no reactions here."}
              </p>
            ) : (
              <span className="flex gap-1">
                {quick.map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    aria-label={r.emoji}
                    aria-pressed={r.selected}
                    className="grid size-9 cursor-pointer place-items-center rounded-md text-[20px] hover:bg-white/[0.12] aria-pressed:bg-white/[0.2]"
                    onClick={() => {
                      setPicking(false);
                      void press(() => xChatReact(path, item.id, r.emoji));
                    }}
                  >
                    {r.emoji}
                  </button>
                ))}
              </span>
            )}
          </Popover>
          <button
            type="button"
            aria-label="Reply"
            disabled={send !== null}
            className={cn(ROUND, "disabled:cursor-default disabled:opacity-50")}
            onClick={reply}
          >
            <Reply className="size-4" />
          </button>
        </>
      ) : null}
      <Menu
        label="Message actions"
        align="end"
        onOpenChange={(open) => {
          if (!open) return;
          setMenu(undefined);
          void xChatMenu(path, item.id).then(setMenu);
        }}
        trigger={
          <button type="button" aria-label="More" className={ROUND}>
            <MoreHorizontal className="size-4" />
          </button>
        }
      >
        {menu === undefined || menu === null ? (
          <MenuItem disabled onClick={() => {}}>
            {menu === undefined ? "Loading from X" : "X offers nothing on this message now."}
          </MenuItem>
        ) : (
          <>
            {menu.rows.map((row) => (
              <MenuItem
                key={row.label}
                disabled={send !== null && drafting(row.icon)}
                onClick={() => pick(row)}
              >
                {row.label}
              </MenuItem>
            ))}
            {menu.info.map((line) => (
              <MenuItem key={line} disabled onClick={() => {}}>
                {line}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </span>
  );
}

/**
 * Xtend's composer on X's conversation `path`, whose messages Xtend read are `known`: the text goes
 * to X's own composer and Send only on the user's Send, and stays until X marks the message it sent.
 */
function Composer({
  path,
  known,
}: {
  readonly path: string;
  readonly known: ReadonlyArray<string>;
}) {
  const { press, setToast } = usePress();
  const { draft, setDraft, send, setWrite } = useDraft(path);
  const { text, mode } = draft;
  const submit = async () => {
    if (text.trim() === "" || send !== null) return;
    // An edit to the same words has nothing for X to save.
    if (mode?.kind === "edit" && sameWords(text, mode.old)) return setDraft(emptyDraft);
    const old = mode?.kind === "edit" ? mode.old : null;
    setWrite((w) => ({ ...w, send: { path, text, old, id: null } }));
    const to =
      mode === null
        ? {}
        : mode.kind === "reply"
          ? { reply: mode.item.id }
          : { edit: { id: mode.item.id, old: mode.old } };
    const sent = await press(() => xChatSend(path, text, known, to));
    // X still sends the message it pinned: the chat's reads settle it (`sendMark`).
    if (sent?.status === "pending" && sent.id !== null) {
      const { id } = sent;
      return setWrite((w) => (w.send === null ? w : { ...w, send: { ...w.send, id } }));
    }
    setWrite((w) => endSend(w, sent?.status === "sent"));
    if (sent === null || sent.status === "sent") return;
    setToast({
      text:
        sent.status === "failed"
          ? "Message failed to send"
          : sent.status === "draft"
            ? DRAFT_HELD
            : "X has not shown it yet. Check the chat before sending again.",
    });
  };
  return (
    <div className="border-t border-border px-4 py-3">
      {mode === null ? null : (
        <div className="mb-2 flex items-center gap-3 px-1 text-[13px]">
          <span className="min-w-0 flex-1">
            <b className="block truncate">
              {mode.kind === "reply" ? mode.item.sender : "Edit message"}
            </b>
            {mode.kind === "reply" ? (
              <span className="block truncate text-[#71767b]">
                {mode.item.text || mode.item.media}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            aria-label={mode.kind === "reply" ? "Cancel reply" : "Discard edit"}
            disabled={send !== null}
            className={ROUND}
            onClick={() => setDraft({ text: mode.kind === "edit" ? "" : text, mode: null })}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl bg-[#202327] py-1.5 pr-1.5 pl-4 focus-within:ring-1 focus-within:ring-[#1d9bf0] focus-within:ring-inset">
        <textarea
          aria-label="Message"
          placeholder="Message"
          rows={1}
          value={text}
          disabled={send !== null}
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 outline-hidden [field-sizing:content] placeholder:text-[#71767b]"
          onChange={(e) => setDraft({ text: e.target.value, mode })}
          onKeyDown={(e) => {
            // X's Enter sends and Shift+Enter starts a line.
            if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
        <button
          type="button"
          disabled={text.trim() === "" || send !== null}
          className="h-8 shrink-0 cursor-pointer rounded-full bg-[#1d9bf0] px-4 text-[14px] font-bold text-white disabled:cursor-default disabled:opacity-50"
          onClick={() => void submit()}
        >
          {send?.path === path ? "Sending…" : mode?.kind === "edit" ? "Save" : "Send"}
        </button>
      </div>
    </div>
  );
}

/**
 * A conversation as X draws it, and what the user does there through X's own controls. Keyed by
 * X's path, so a draft never follows the user into another conversation.
 */
function Conversation({
  path,
  conversation,
  head,
  group,
  onMoved,
}: {
  readonly path: string;
  readonly conversation: ChatState["conversation"];
  readonly head: ChatRow | undefined;
  readonly group: boolean;
  /** X may have moved on after a step the user answered in X's page: Chat follows X there. */
  readonly onMoved: () => void;
}) {
  const navigate = useNavigate();
  const setOver = useAtomSet(xOverAtom);
  const { press } = usePress();
  const olderAsked = useRef(-1);
  // Its own messages are how Xtend knows X shows this conversation: with none, X's page writes.
  const known = (conversation?.items ?? []).flatMap((i) => (i.kind === "message" ? [i.id] : []));
  const drawn = known.length > 0;
  const answer = async (request: "accept" | "delete") => {
    const answered = await press(() => xChatRequest(path, request, setOver));
    // A confirm the user left unanswered for another screen moves nothing.
    if (answered === "done" || answered === "over") onMoved();
  };
  return (
    <>
      <div className="drag-region flex min-h-[53px] items-center gap-3 border-b border-border px-4">
        {head === undefined ? null : <Faces urls={head.avatars} size={32} />}
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">
          {conversation?.title ?? head?.name ?? ""}
        </h2>
        <button
          type="button"
          aria-label="More"
          className={cn("no-drag", ROUND)}
          onClick={() =>
            void press(() => xChatInfo(path, setOver)).then((shown) => shown && onMoved())
          }
        >
          <MoreHorizontal className="size-[18px]" />
        </button>
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
            empty="Opening the conversation in X."
            onReopen={() => void xNavigate(`https://x.com${path}`)}
          />
        ) : (
          <Virtuoso
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
            itemContent={(_, item) => (
              <Item
                item={item}
                group={group}
                actions={
                  item.kind === "message" ? (
                    <MessageActions
                      path={path}
                      item={item}
                      composer={conversation.composer}
                      known={known}
                    />
                  ) : null
                }
              />
            )}
          />
        )}
      </div>
      {conversation?.request != null ? (
        <div className="flex flex-col items-center gap-3 border-t border-border p-4">
          <p className="text-center text-[15px] text-[#71767b]">{conversation.request}</p>
          <div className="flex w-full max-w-[400px] gap-2">
            <button
              type="button"
              className="h-9 flex-1 cursor-pointer rounded-full border border-white/[0.18] text-[15px] font-bold hover:bg-white/[0.06]"
              onClick={() => void answer("delete")}
            >
              Delete
            </button>
            <button
              type="button"
              className="h-9 flex-1 cursor-pointer rounded-full bg-foreground text-[15px] font-bold text-background"
              onClick={() => void answer("accept")}
            >
              Accept
            </button>
          </div>
        </div>
      ) : conversation?.composer !== true ? null : drawn ? (
        <Composer path={path} known={known} />
      ) : (
        <div className="border-t border-border p-4 text-center">
          <button
            type="button"
            className="h-9 cursor-pointer rounded-full bg-foreground px-4 text-[15px] font-bold text-background"
            onClick={() => void press(() => xChatFirst(path, setOver))}
          >
            Write the first message in X
          </button>
        </div>
      )}
    </>
  );
}

/**
 * X's Chat, drawn by Xtend from X's own page: the inbox, its message requests and, once clicked,
 * a conversation. X opens a conversation only for the user's click on its row, since opening one
 * marks it read. Writing goes through X's own controls in X's page, for the user's click.
 */
function ChatScreen() {
  const { tab, c } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const [chat, setChat] = useAtom(chatAtom);
  const setWrite = useAtomSet(chatWriteAtom);
  const setOver = useAtomSet(xOverAtom);
  const [query, setQuery] = useState("");
  // X drew no search to type the query into, even on its inbox.
  const [noSearch, setNoSearch] = useState(false);
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
    watchChat(stop.signal, (read) => {
      setChat((s) => mergeChat(s, read));
      setWrite((w) => {
        const mark = sendMark(w, read);
        return mark === null ? w : endSend(w, mark === "sent");
      });
    });
    return () => {
      stop.abort();
      setChat((s) => ({ ...s, locked: false, search: null }));
    };
  }, [setChat, setWrite]);
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
    let gone = false;
    const timer = setTimeout(() => {
      typed.current = q !== "";
      setNoSearch(false);
      void xChatSearch(q).then(async (done) => {
        if (done || q === "" || gone) return;
        // X's conversation and requests pages draw no search; its inbox does.
        await xGo("https://x.com/i/chat");
        if (!gone && !(await xChatSearch(q, true)) && !gone) setNoSearch(true);
      });
    }, 250);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [query]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- closes the query Xtend typed into X's chat search when the screen goes.
  useEffect(
    () => () => {
      if (typed.current) void xChatSearch("");
    },
    [],
  );

  const inboxAsked = useRef(-1);
  const { press } = usePress();
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
  /**
   * Where X went after a step the user answered in X's own page (a request deleted, a chat started,
   * a conversation left): Chat shows X's conversation there, X having opened it, or X's list.
   */
  const follow = async (from: string | null) => {
    const at = await xRun("location.pathname");
    if (typeof at !== "string" || at === from) return;
    const conversation = isChatPath(at) && !Object.values(LIST_PATH).includes(at);
    opened.current = conversation ? at : null;
    if (conversation) setChat((s) => ({ ...s, path: at }));
    void navigate({ to: "/chat", search: conversation ? { tab, c: at } : { tab } });
  };
  // X's New message sits on its inbox, so an open conversation closes for it.
  const startChat = async () => {
    const shown = await press(() => {
      void navigate({ to: "/chat", search: { tab: "all" } });
      return xChatNew(setOver);
    });
    if (shown === true) await follow(null);
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
          <h1 className="flex-1 text-[20px] font-bold">Chat</h1>
          <button
            type="button"
            aria-label="New message"
            className={cn("no-drag", ROUND)}
            onClick={() => void startChat()}
          >
            <SquarePen className="size-[18px]" />
          </button>
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
          {searching && noSearch ? (
            <Empty>X shows no chat search right now.</Empty>
          ) : rows === null ? (
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
              Choose from your existing conversations, or start a new one.
            </p>
          </div>
        ) : (
          <Conversation
            key={open}
            path={open}
            conversation={conversation}
            head={head}
            group={group}
            onMoved={() => void follow(open)}
          />
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

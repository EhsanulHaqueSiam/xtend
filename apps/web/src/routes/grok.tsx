import { useAtom, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Leads_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { Check, Pencil, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StageText } from "../components/leads/ui";
import { Empty } from "../components/ui/layout";
import { FollowButton } from "../components/xnative/FollowButton";
import { GrokBar, GrokBox, GrokConversation, useGrokPress } from "../components/xnative/Grok";
import { Avatar } from "../components/xnative/XPostView";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { clientRuntime, XtendClient } from "../rpc/client";
import { engineAtom, userByHandle } from "../state/engine";
import {
  type GrokHistoryRow,
  type GrokState,
  grokAtom,
  grokWriteAtom,
  isGrokPath,
  namedHandles,
  settleSend,
  watchGrok,
  xGrokHistory,
  xGrokHistoryPress,
} from "../state/grok";
import { addPersonAtom } from "../state/leads";
import { xGo, xOverAtom, xRun } from "../state/x";

const ROUND =
  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-[#71767b] hover:bg-white/[0.08] hover:text-foreground";

/** A person Grok named, as Xtend's Leads knows them: free, from the user's own data. */
const leadAtom = Atom.family((handle: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      const page = yield* client[Leads_METHODS.peopleList]({ search: handle });
      return page.people.find((p) => p.handle.toLowerCase() === handle.toLowerCase()) ?? null;
    }),
  ),
);

/** One person Grok named: their face and name as X described them, their Lead stage, Follow or Track. */
function Named({ handle }: { readonly handle: string }) {
  const engine = useAtomValue(engineAtom);
  const user = userByHandle(engine, handle);
  const lead = AsyncResult.getOrElse(useAtomValue(leadAtom(handle)), () => undefined);
  const refresh = useAtomRefresh(leadAtom(handle));
  const add = useAtomSet(addPersonAtom, { mode: "promise" });
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar url={user?.avatarUrl ?? null} size={32} />
      <Link
        to="/u/$handle"
        params={{ handle }}
        className="min-w-0 flex-1 truncate text-[15px] font-bold hover:underline"
      >
        {user?.name ?? `@${handle}`}
      </Link>
      {lead === undefined ? null : lead === null ? (
        <button
          type="button"
          className="cursor-pointer text-[13px] font-bold text-[#1d9bf0] hover:underline"
          onClick={() =>
            void add({
              handle,
              name: user?.name ?? handle,
              userId: user?.userId ?? null,
              followers: user?.followers ?? null,
              bio: user?.bio ?? "",
              source: "grok",
            }).then(refresh)
          }
        >
          Track
        </button>
      ) : (
        <span className="text-[13px]">
          Lead · <StageText stage={lead.stage} />
        </span>
      )}
      <FollowButton user={user} size="sm" />
    </li>
  );
}

/** A history row as X draws it, with X's own Pin, Rename and Delete, and X's inline confirm. */
function HistoryRow({
  row,
  query,
  open,
  onOpen,
  onChanged,
}: {
  readonly row: GrokHistoryRow;
  /** The rail's search, which X's own History holds when the row is pressed. */
  readonly query: string;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onChanged: () => void;
}) {
  const { press } = useGrokPress();
  const [mode, setMode] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState(row.title);
  const act = async (action: "pin" | "unpin" | "rename" | "delete", value = "") => {
    setMode(null);
    if ((await press(() => xGrokHistoryPress(row.id, action, value, query))) !== null) onChanged();
  };
  return (
    <li
      data-x="grok-history-row"
      className={cn(
        "group flex h-10 items-center gap-1 rounded-lg px-2 hover:bg-white/[0.04]",
        (open || row.current) && "bg-white/[0.08]",
      )}
    >
      {mode === "rename" ? (
        <input
          aria-label="Rename"
          autoFocus
          value={title}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim() !== "") void act("rename", title.trim());
            if (e.key === "Escape") setMode(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[15px]"
          onClick={onOpen}
        >
          {row.pinned ? <Pin className="size-3.5 shrink-0 text-[#71767b]" /> : null}
          <span className="truncate">{row.title}</span>
        </button>
      )}
      {mode === null ? (
        <>
          <span className="shrink-0 text-[13px] text-[#71767b] group-hover:hidden">{row.age}</span>
          <span className="hidden shrink-0 items-center group-hover:flex">
            <button
              type="button"
              aria-label={row.pinned ? "Unpin" : "Pin"}
              className={ROUND}
              onClick={() => void act(row.pinned ? "unpin" : "pin")}
            >
              {row.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
            </button>
            <button
              type="button"
              aria-label="Rename"
              className={ROUND}
              onClick={() => {
                setTitle(row.title);
                setMode("rename");
              }}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              className={ROUND}
              onClick={() => setMode("delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        </>
      ) : (
        <span className="flex shrink-0 items-center">
          <button type="button" aria-label="Cancel" className={ROUND} onClick={() => setMode(null)}>
            <X className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={mode === "delete" ? "Delete" : "Save"}
            disabled={mode === "rename" && title.trim() === ""}
            className={cn(ROUND, mode === "delete" && "text-[#f4212e]")}
            onClick={() => void (mode === "delete" ? act("delete") : act("rename", title.trim()))}
          >
            <Check className="size-3.5" />
          </button>
        </span>
      )}
    </li>
  );
}

/** X's Grok history in the rail: X's search, its groups, its rows, and its next page. */
function History({
  grok,
  open,
  onOpen,
  onLoad,
}: {
  readonly grok: GrokState;
  readonly open: string | undefined;
  readonly onOpen: (id: string) => void;
  readonly onLoad: (query: string, more?: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const history = grok.history;
  const groups = new Map<string, Array<GrokHistoryRow>>();
  for (const row of history?.rows ?? [])
    groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  return (
    <section aria-label="History" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 px-4 pt-3 pb-2 text-[15px] font-bold">
        <span className="border-b-2 border-[#1d9bf0] pb-1">Chats</span>
      </div>
      <label className="mx-4 mb-2 flex h-9 items-center gap-2 rounded-full border border-white/[0.16] px-3 focus-within:border-[#1d9bf0]">
        <Search className="size-4 text-[#71767b]" />
        <input
          aria-label="Search conversations"
          placeholder="Search conversations"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
          value={query}
          onChange={(e) => {
            const q = e.target.value;
            setQuery(q);
            // X searches its own history a moment after the last key, as X's field does.
            clearTimeout(typing.current);
            typing.current = setTimeout(() => onLoad(q.trim()), 250);
          }}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {history === null ? (
          <p className="px-2 py-6 text-center text-[13px] text-[#71767b]">
            Loading your history from X.
          </p>
        ) : history.rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-[#71767b]">
            {history.status ??
              "No conversations yet. Start a conversation to see your history here."}
          </p>
        ) : (
          <>
            {[...groups].map(([group, rows]) => (
              <div key={group}>
                <h3 className="px-2 pt-3 pb-1 text-[12px] font-bold tracking-wide text-[#71767b] uppercase">
                  {group}
                </h3>
                <ul>
                  {rows.map((row) => (
                    <HistoryRow
                      key={row.id}
                      row={row}
                      query={history.query}
                      open={row.id === open}
                      onOpen={() => onOpen(row.id)}
                      onChanged={() => onLoad(query.trim())}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {history.more ? (
              <button
                type="button"
                className="mx-2 mt-2 cursor-pointer text-[13px] text-[#1d9bf0] hover:underline"
                onClick={() => onLoad(query.trim(), true)}
              >
                Load more
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * X's Grok page, drawn by Xtend from X's own page: X's conversation in the column, X's history in
 * the rail (one click to switch chats), and Xtend's part under it: the people Grok named, with
 * the user's own stage for them. Grok is X's, on the user's X account; nothing here is Xtend's AI.
 */
function GrokScreen() {
  const { c } = Route.useSearch();
  const navigate = useNavigate();
  const [grok, setGrok] = useAtom(grokAtom);
  const [write, setWrite] = useAtom(grokWriteAtom);
  const setOver = useAtomSet(xOverAtom);
  const read = grok.read;
  const page = read?.page ?? null;
  const asked = useRef(false);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to X's Grok page or the conversation the user opened.
  useEffect(() => {
    if (c !== undefined) return void xGo(`https://x.com/i/grok/c/${encodeURIComponent(c)}`);
    // X's Grok page already shows: it keeps the conversation X has open there.
    void xRun("location.pathname").then((at) => {
      if (typeof at !== "string" || !isGrokPath(at)) void xGo("https://x.com/i/grok");
    });
  }, [c]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's Grok page while this screen is open, and only then.
  useEffect(() => {
    if (!isElectron) return;
    const stop = new AbortController();
    watchGrok(stop.signal, (next) => {
      // X's own History page (its compact layout), while the rail reads it: the chat stays.
      if (next.path === "/i/grok/history") return;
      setGrok((s) => ({ ...s, read: next }));
      setWrite((w) => settleSend(w, next));
    });
    return () => stop.abort();
  }, [setGrok, setWrite]);
  // X's older Grok page and its account link prompt are X's to show: over the main area.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- shows the engine over the main area while X draws a Grok page Xtend does not read.
  useEffect(() => {
    const other = page === "other" || (read?.path.startsWith("/i/jf/grok") ?? false);
    setOver(other);
    return () => setOver(false);
  }, [page, read?.path, setOver]);

  const load = useCallback(
    (query: string, more = false) =>
      void xGrokHistory(query, more).then((history) => {
        if (history !== null) setGrok((s) => ({ ...s, history: { ...history, query } }));
      }),
    [setGrok],
  );
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- reads X's history once X draws its Grok page.
  useEffect(() => {
    if (page !== "xweb" || asked.current) return;
    asked.current = true;
    load("");
  }, [page, load]);
  // A question X shows asked lands in X's history: the rail reads it again.
  const sending = write.send !== null;
  const was = useRef(sending);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- rereads X's history once a send X showed ends.
  useEffect(() => {
    if (was.current && !sending) load(grok.history?.query ?? "");
    was.current = sending;
  }, [sending, load, grok.history?.query]);

  if (!isElectron)
    return (
      <Empty>
        Grok runs in the desktop app. Grok is your X account's, so it needs X's page under Xtend. In
        the browser, Xtend's own assist still works on every screen.
      </Empty>
    );

  const openRow = (id: string) => {
    const path = `/i/grok/c/${encodeURIComponent(id)}`;
    if (!isGrokPath(path)) return;
    // The route may still name it while X has moved on (X's New chat, a delete): X opens it again.
    if (id === c) void xGo(`https://x.com${path}`);
    else void navigate({ to: "/grok", search: { c: id } });
  };
  // Only a finished answer: a handle X is still streaming may be cut short.
  const last = (read?.turns ?? []).findLast((t) => t.answer?.done === true)?.answer;
  const named = read?.private === true || last == null ? [] : namedHandles(last);

  return (
    <div className="flex h-full min-h-0 bg-black">
      <section aria-label="Grok" className="flex min-w-0 flex-1 flex-col">
        {read === null || page !== "xweb" ? (
          <>
            <div className="drag-region min-h-[53px]" />
            <Empty>Opening Grok in X.</Empty>
          </>
        ) : (
          <>
            <GrokBar read={read} onNew={() => void navigate({ to: "/grok", search: {} })} />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <GrokConversation read={read} />
            </div>
            <GrokBox read={read} />
          </>
        )}
      </section>
      <aside
        aria-label="Grok rail"
        className="flex w-[360px] min-w-[300px] shrink-0 flex-col border-l border-border"
      >
        <History grok={grok} open={c} onOpen={openRow} onLoad={load} />
        {named.length === 0 ? null : (
          <section aria-label="In this answer" className="border-t border-border px-4 py-3">
            <h3 className="flex justify-between text-[12px] font-bold tracking-wide text-[#71767b] uppercase">
              In this answer
              <span className="font-mono font-normal normal-case">Xtend, free</span>
            </h3>
            <ul>
              {named.slice(0, 6).map((h) => (
                <Named key={h} handle={h} />
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Grok on X" className="border-t border-border px-4 py-3">
          <h3 className="mb-2 text-[12px] font-bold tracking-wide text-[#71767b] uppercase">
            Grok on X
          </h3>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[13.5px]">
            <dt className="text-[#71767b]">Runs on</dt>
            <dd className="text-right font-mono text-[13px]">your X account</dd>
            <dt className="text-[#71767b]">Cost</dt>
            <dd className="text-right font-mono text-[13px] text-success-foreground">
              free, X's limits
            </dd>
            <dt className="text-[#71767b]">History</dt>
            <dd className="text-right font-mono text-[13px]">X's</dd>
          </dl>
        </section>
      </aside>
    </div>
  );
}

export const Route = createFileRoute("/grok")({
  validateSearch: (s: Record<string, unknown>): { c?: string } =>
    typeof s.c === "string" && isGrokPath(`/i/grok/c/${encodeURIComponent(s.c)}`) ? { c: s.c } : {},
  component: GrokScreen,
});

import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Draft, PendingRequest } from "@xtend/contracts";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { CalendarClock, ExternalLink, Pencil, Trash2, Undo2, Zap } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { approvePendingAtom, dismissPendingAtom, pendingAtom } from "../../state/automate";
import { deleteDraftAtom, draftsAtom } from "../../state/compose";
import { queueAtom, unscheduleAtom } from "../../state/plan";
import { xNavigate, xPanelOpenAtom } from "../../state/x";
import { SubTabs, xAction, xMeta, xPill, xPillSm, xPillSolid } from "../x";
import { failText } from "./AssistPanel";
import { fmtWhen, statusTone } from "./DraftsList";

export const COMPOSE_TABS = ["drafts", "queued", "automatic", "failed", "posted"] as const;
export type ComposeTab = (typeof COMPOSE_TABS)[number];

const STATUSES: Record<ComposeTab, ReadonlyArray<Draft["status"]>> = {
  drafts: ["draft"],
  queued: ["queued", "posting"],
  automatic: ["suggested"],
  failed: ["failed"],
  posted: ["posted"],
};

/** The tab a draft lives under, so the editor's back arrow returns to it. */
export const tabOf = (status: Draft["status"]): ComposeTab =>
  COMPOSE_TABS.find((tab) => STATUSES[tab].includes(status)) ?? "drafts";

const EMPTY: Record<ComposeTab, string> = {
  drafts: "No drafts. Start one above, or press C anywhere in X.",
  queued: "Nothing queued. Queued drafts post at the next free slot from Plan.",
  automatic: "Nothing waiting. Library and Automate put their drafts and ask-first actions here.",
  failed: "No failed posts.",
  posted: "Nothing posted from Xtend yet.",
};

const usd = (n: number) => `$${n.toFixed(3)}`;
const statusUrl = (postId: string) => `https://x.com/i/web/status/${postId}`;

/** Where a suggested draft came from, from the free-form source its writer left on it. */
const sourceLabel = (source: string | null) =>
  source === null
    ? null
    : source.startsWith("format:")
      ? `Library format · ${source.split(":")[1] ?? ""}`
      : source.startsWith("ready-to-post: ")
        ? `Ready to post · ${source.slice("ready-to-post: ".length)}`
        : source.startsWith("http")
          ? "From a saved post"
          : source;

const meta = (d: Draft) =>
  d.status === "queued"
    ? `Queued · ${d.scheduledAt === null ? "next slot" : fmtWhen(d.scheduledAt)}`
    : d.status === "posting"
      ? "Posting…"
      : d.status === "posted"
        ? `Posted${d.postedAt === null ? "" : ` · ${fmtWhen(d.postedAt)}`}`
        : d.status === "failed"
          ? "Failed"
          : d.status === "suggested"
            ? "Suggested"
            : `Edited ${fmtWhen(d.updatedAt)}`;

/** On the desktop the post opens in the x.com panel beside Compose; in a browser, a new tab. */
function useOpenOnX() {
  const setPanel = useAtomSet(xPanelOpenAtom);
  return (url: string) => {
    if (!isElectron) return void window.open(url, "_blank", "noreferrer");
    xNavigate(url);
    setPanel(true);
  };
}

function Avatar({ label, className }: { readonly label: string; readonly className?: string }) {
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-[#333639] text-sm font-bold",
        className,
      )}
    >
      {label}
    </div>
  );
}

/** A draft drawn as the X post it will become, with its status where X puts the time. */
function DraftRow({
  draft: d,
  handle,
  onOpen,
  onAct,
}: {
  readonly draft: Draft;
  readonly handle: string | null;
  readonly onOpen: (id: string) => void;
  readonly onAct: (what: "queue" | "unschedule" | "delete", id: string) => void;
}) {
  const openOnX = useOpenOnX();
  const editable = d.status !== "posted" && d.status !== "posting";
  const text = d.kind === "article" ? d.body : (d.blocks[0]?.text ?? "");
  const source = d.status === "suggested" ? sourceLabel(d.source) : null;
  return (
    <article
      className={cn(
        "flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-white/[0.03]",
        editable && "cursor-pointer",
      )}
      onClick={() => (editable ? onOpen(d.id) : undefined)}
    >
      <Avatar label={(handle ?? "you").slice(0, 1).toUpperCase()} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 text-[15px] leading-5">
          <span className="truncate font-bold">{handle ?? "You"}</span>
          {handle !== null ? (
            <span className="truncate text-muted-foreground">@{handle}</span>
          ) : null}
          <span className={cn("ml-auto shrink-0 pl-2 text-[13px]", statusTone[d.status])}>
            {meta(d)}
          </span>
        </div>
        {d.kind === "article" ? (
          <p className="mt-0.5 text-[15px] font-bold">{d.title || "Untitled article"}</p>
        ) : null}
        <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-5">
          {text.trim() === "" ? <span className="text-placeholder">Empty draft</span> : text}
        </p>
        {d.kind === "thread" && d.blocks.length > 1 ? (
          <p className="mt-1 text-[15px] text-primary">
            Show this thread · {d.blocks.length} posts
          </p>
        ) : null}
        {d.media.length > 0 ? (
          <p className={cn(xMeta, "mt-1")}>
            {d.media.length} {d.media.length === 1 ? "attachment" : "attachments"}
          </p>
        ) : null}
        {source !== null ? <p className={cn(xMeta, "mt-1")}>{source}</p> : null}
        {d.status === "failed" && d.error !== null ? (
          <p className="mt-1 text-[13px] text-[#f4212e]">{d.error}</p>
        ) : null}
        {/* Actions act on the row, not open it. */}
        <div className="-ml-2.5 mt-1 flex flex-wrap" onClick={(e) => e.stopPropagation()}>
          {editable ? (
            <button type="button" className={xAction} onClick={() => onOpen(d.id)}>
              <Pencil />
              Edit
            </button>
          ) : null}
          {d.status === "draft" || d.status === "suggested" || d.status === "failed" ? (
            <button type="button" className={xAction} onClick={() => onAct("queue", d.id)}>
              <CalendarClock />
              {d.status === "failed" ? "Retry at next slot" : "Queue"}
            </button>
          ) : null}
          {d.status === "queued" ? (
            <button type="button" className={xAction} onClick={() => onAct("unschedule", d.id)}>
              <Undo2 />
              Unschedule
            </button>
          ) : null}
          {d.status === "posted" && d.postIds[0] !== undefined ? (
            <button
              type="button"
              className={xAction}
              onClick={() => openOnX(statusUrl(d.postIds[0]!))}
            >
              <ExternalLink />
              View on X
            </button>
          ) : null}
          {editable && d.status !== "queued" ? (
            <button type="button" className={xAction} onClick={() => onAct("delete", d.id)}>
              <Trash2 />
              {d.status === "suggested" ? "Dismiss" : "Delete"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** An ask-first automation run waiting for a click; approving pays the price shown on it. */
function PendingRow({
  request,
  onDecide,
}: {
  readonly request: PendingRequest;
  readonly onDecide: (approve: boolean, id: number) => void;
}) {
  return (
    <article className="flex gap-3 border-b border-border px-4 py-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Zap className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 text-[15px] leading-5">
          <span className="truncate font-bold">{request.ruleName}</span>
          <span className="ml-auto shrink-0 pl-2 text-[13px] text-muted-foreground">
            {fmtWhen(request.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-5">{request.description}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className={cn(xPillSolid, xPillSm)}
            onClick={() => onDecide(true, request.id)}
          >
            Approve · {usd(request.costUsd)}
          </button>
          <button
            type="button"
            className={cn(xPill, xPillSm)}
            onClick={() => onDecide(false, request.id)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * Compose's landing page: every draft as the X post it will become, grouped by where it is
 * (yours, queued, written for you by Library and Automate, failed, posted), under X's own
 * "What's happening?" box. Opening a draft or the box goes to the composer.
 */
export function DraftsHome({
  tab,
  handle,
  onTab,
  onOpen,
  onNew,
}: {
  readonly tab: ComposeTab;
  readonly handle: string | null;
  readonly onTab: (tab: ComposeTab) => void;
  readonly onOpen: (id: string) => void;
  readonly onNew: () => void;
}) {
  const drafts = useAtomValue(draftsAtom);
  const refreshDrafts = useAtomRefresh(draftsAtom);
  const pending = AsyncResult.getOrElse(useAtomValue(pendingAtom), () => []).filter(
    (r) => r.status === "pending",
  );
  const refreshPending = useAtomRefresh(pendingAtom);
  const queue = useAtomSet(queueAtom, { mode: "promiseExit" });
  const unschedule = useAtomSet(unscheduleAtom, { mode: "promiseExit" });
  const remove = useAtomSet(deleteDraftAtom, { mode: "promiseExit" });
  const approve = useAtomSet(approvePendingAtom, { mode: "promiseExit" });
  const dismiss = useAtomSet(dismissPendingAtom, { mode: "promiseExit" });
  const [notice, setNotice] = useState<string | null>(null);

  const all = AsyncResult.getOrElse(drafts, () => [] as ReadonlyArray<Draft>);
  const count = (t: ComposeTab) => all.filter((d) => STATUSES[t].includes(d.status)).length;
  const shown = all.filter((d) => STATUSES[tab].includes(d.status));

  const report = (exit: Exit.Exit<unknown, unknown>, done: string) =>
    setNotice(Exit.isFailure(exit) ? `Failed: ${failText(exit.cause)}` : done);
  const act = async (what: "queue" | "unschedule" | "delete", id: string) => {
    const exit =
      what === "queue"
        ? await queue(id)
        : what === "unschedule"
          ? await unschedule(id)
          : await remove(id);
    report(
      exit,
      what === "queue"
        ? "Queued for the next slot"
        : what === "unschedule"
          ? "Back in drafts"
          : "Removed",
    );
    refreshDrafts();
  };
  const decide = async (yes: boolean, id: number) => {
    report(yes ? await approve(id) : await dismiss(id), yes ? "Approved" : "Dismissed");
    refreshPending();
    refreshDrafts();
  };

  return (
    <div className="flex h-full flex-col">
      <SubTabs
        tabs={[
          { id: "drafts", label: "Drafts", count: count("drafts") },
          { id: "queued", label: "Queued", count: count("queued") },
          { id: "automatic", label: "Automatic", count: count("automatic") + pending.length },
          { id: "failed", label: "Failed", count: count("failed") },
          { id: "posted", label: "Posted" },
        ]}
        value={tab}
        onChange={onTab}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <button
          type="button"
          className="flex w-full cursor-text items-center gap-3 border-b border-border px-4 py-3 text-left"
          onClick={onNew}
        >
          <Avatar label={(handle ?? "you").slice(0, 1).toUpperCase()} />
          <span className="flex-1 py-2 text-xl text-placeholder">What's the thread?</span>
          <span className={cn(xPillSolid, "pointer-events-none")}>Draft</span>
        </button>
        {notice !== null ? (
          <p
            role="status"
            className={cn(
              "border-b border-border px-4 py-2 text-[13px]",
              notice.startsWith("Failed") ? "text-[#f4212e]" : "text-muted-foreground",
            )}
          >
            {notice}
          </p>
        ) : null}
        {tab === "automatic"
          ? pending.map((r) => <PendingRow key={r.id} request={r} onDecide={decide} />)
          : null}
        {AsyncResult.match(drafts, {
          onInitial: () => <p className={cn(xMeta, "px-4 py-8 text-center")}>Loading…</p>,
          onFailure: (f) => (
            <p className="px-4 py-8 text-center text-[13px] text-[#f4212e]">{failText(f.cause)}</p>
          ),
          onSuccess: () =>
            shown.length === 0 && !(tab === "automatic" && pending.length > 0) ? (
              <p className={cn(xMeta, "px-8 py-10 text-center text-[15px] leading-5")}>
                {EMPTY[tab]}
              </p>
            ) : (
              shown.map((d) => (
                <DraftRow key={d.id} draft={d} handle={handle} onOpen={onOpen} onAct={act} />
              ))
            ),
        })}
      </div>
    </div>
  );
}

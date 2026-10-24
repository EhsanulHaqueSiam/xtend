import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Draft, PendingRequest } from "@xtend/contracts";
import { Link } from "@tanstack/react-router";
import * as Exit from "effect/Exit";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { approvePendingAtom, dismissPendingAtom, pendingAtom } from "../../state/automate";
import { deleteDraftAtom, draftsAtom } from "../../state/compose";
import { usd } from "../../state/costs";
import { queueAtom, unscheduleAtom } from "../../state/plan";
import { xNavigate, xPanelOpenAtom } from "../../state/x";
import { PageHeader } from "../PageHeader";
import { sectionLabel, SECTIONS, type SectionId } from "../shell/sections";
import { Button } from "../ui/button";
import { Cost, Empty, PageBody, table } from "../ui/layout";
import { failText } from "./AssistPanel";
import { draftTitle, fmtWhen, sumUsd, useDraftCost } from "./DraftsList";

export type ComposeTab = SectionId<"/compose">;
export const COMPOSE_TABS: ReadonlyArray<ComposeTab> = SECTIONS["/compose"].map((s) => s.id);

const STATUSES: Record<ComposeTab, ReadonlyArray<Draft["status"]>> = {
  drafts: ["draft"],
  queued: ["queued", "posting"],
  automatic: ["suggested"],
  failed: ["failed"],
  posted: ["posted"],
};

/** The section a draft lives under, so the editor's way back returns to it. */
export const tabOf = (status: Draft["status"]): ComposeTab =>
  COMPOSE_TABS.find((tab) => STATUSES[tab].includes(status)) ?? "drafts";

/** What the time column means in each section. */
const WHEN: Record<ComposeTab, string> = {
  drafts: "Edited",
  queued: "Posts at",
  automatic: "Added",
  failed: "Failed",
  posted: "Posted",
};

const when = (d: Draft) =>
  d.status === "posting"
    ? "posting"
    : d.status === "queued"
      ? d.scheduledAt === null
        ? "next slot"
        : fmtWhen(d.scheduledAt)
      : d.status === "posted"
        ? d.postedAt === null
          ? ""
          : fmtWhen(d.postedAt)
        : fmtWhen(d.updatedAt);

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

/** The line under a draft's title: why it failed, where it came from, or how it goes on. */
const subline = (d: Draft): { readonly text: string; readonly tone?: string } | null => {
  if (d.status === "failed" && d.error !== null)
    return { text: d.error, tone: "text-error-foreground" };
  const source = d.status === "suggested" ? sourceLabel(d.source) : null;
  if (source !== null) return { text: source };
  // An article's title is its first line, so the body follows; a thread's hook is its first line.
  const first = d.blocks[0]?.text ?? "";
  const rest =
    d.kind === "article"
      ? d.body.trim()
      : first.split("\n").slice(1).join(" ").trim() || (d.blocks[1]?.text ?? "").trim();
  return rest === "" ? null : { text: rest.replace(/\s+/g, " ") };
};

/** On the desktop the post opens in the x.com panel beside Compose; in a browser, a new tab. */
function useOpenOnX() {
  const setPanel = useAtomSet(xPanelOpenAtom);
  return (url: string) => {
    if (!isElectron) return void window.open(url, "_blank", "noreferrer");
    xNavigate(url);
    setPanel(true);
  };
}

type RowAction = "queue" | "unschedule" | "delete";

/** One draft: its first line and what follows, then posts, price and time in mono columns. */
function DraftRow({
  draft: d,
  costUsd,
  onOpen,
  onAct,
}: {
  readonly draft: Draft;
  readonly costUsd: number | null;
  readonly onOpen: (id: string) => void;
  readonly onAct: (what: RowAction, id: string) => void;
}) {
  const openOnX = useOpenOnX();
  const editable = d.status !== "posted" && d.status !== "posting";
  const sub = subline(d);
  const posts = d.kind === "article" ? "article" : String(d.blocks.length);
  const blank =
    d.kind === "article"
      ? d.title.trim() === "" && d.body.trim() === ""
      : d.blocks.every((b) => b.text.trim() === "");
  return (
    <tr
      className={cn(table.row, editable && "cursor-pointer")}
      onClick={() => (editable ? onOpen(d.id) : undefined)}
    >
      <td className={cn(table.td, "w-full max-w-0 py-2")}>
        {editable ? (
          <button
            type="button"
            className="block w-full cursor-pointer truncate text-left outline-hidden focus-visible:underline"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(d.id);
            }}
          >
            {blank ? <span className="text-placeholder">Empty draft</span> : draftTitle(d)}
          </button>
        ) : (
          <p className="truncate">{draftTitle(d)}</p>
        )}
        {sub !== null ? (
          <p className={cn("truncate text-xs text-muted-foreground", sub.tone)}>{sub.text}</p>
        ) : null}
      </td>
      <td className={cn(table.td, table.num, "text-muted-foreground")}>
        {posts}
        {d.media.length > 0 ? ` · ${d.media.length} media` : ""}
      </td>
      {d.status === "posted" ? null : (
        <td className={cn(table.td, "text-right")}>
          {costUsd === null ? <Cost label="…" /> : <Cost usd={costUsd} />}
        </td>
      )}
      <td className={cn(table.td, table.num, "whitespace-nowrap text-muted-foreground")}>
        {when(d)}
      </td>
      {/* Actions act on the row, not open it. */}
      <td className={cn(table.td, "w-px")} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-0.5">
          {d.status === "draft" || d.status === "suggested" || d.status === "failed" ? (
            <Button variant="ghost" size="xs" onClick={() => onAct("queue", d.id)}>
              {d.status === "failed" ? "Retry at next slot" : "Queue"}
            </Button>
          ) : null}
          {d.status === "queued" ? (
            <Button variant="ghost" size="xs" onClick={() => onAct("unschedule", d.id)}>
              Unschedule
            </Button>
          ) : null}
          {d.status === "posted" && d.postIds[0] !== undefined ? (
            <Button variant="ghost" size="xs" onClick={() => openOnX(statusUrl(d.postIds[0]!))}>
              View on X
            </Button>
          ) : null}
          {editable && d.status !== "queued" ? (
            <Button variant="ghost-destructive" size="xs" onClick={() => onAct("delete", d.id)}>
              {d.status === "suggested" ? "Dismiss" : "Delete"}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** An ask-first automation run waiting for a click; approving pays the price on its button. */
function PendingRow({
  request,
  onDecide,
}: {
  readonly request: PendingRequest;
  readonly onDecide: (approve: boolean, id: number) => void;
}) {
  return (
    <tr className={table.row}>
      <td className={cn(table.td, "w-full max-w-0 py-2")}>
        <p className="truncate">{request.ruleName}</p>
        <p className="truncate text-xs text-muted-foreground">{request.description}</p>
      </td>
      <td className={cn(table.td, table.num, "whitespace-nowrap text-muted-foreground")}>
        {fmtWhen(request.createdAt)}
      </td>
      <td className={cn(table.td, "w-px")}>
        <div className="flex justify-end gap-1">
          <Button size="xs" onClick={() => onDecide(true, request.id)}>
            Approve
            <Cost tone="solid" usd={request.costUsd} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onDecide(false, request.id)}>
            Dismiss
          </Button>
        </div>
      </td>
    </tr>
  );
}

function Table({ head, children }: { readonly head: ReactNode; readonly children: ReactNode }) {
  return (
    <table className={table.root}>
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** One line per empty section, with the action that fills it when there is one. */
function EmptySection({ tab, onNew }: { readonly tab: ComposeTab; readonly onNew: () => void }) {
  const newDraft = (
    <Button variant="outline" size="sm" onClick={onNew}>
      New draft
    </Button>
  );
  switch (tab) {
    case "drafts":
      return <Empty action={newDraft}>No drafts. Press C anywhere to start one.</Empty>;
    case "queued":
      return <Empty action={newDraft}>Nothing queued. Queued drafts post at your next slot.</Empty>;
    case "automatic":
      return (
        <Empty
          action={
            <Button variant="outline" size="sm" render={<Link to="/automate" />}>
              Automate
            </Button>
          }
        >
          Nothing waiting. Library and Automate leave drafts and ask-first actions here.
        </Empty>
      );
    case "failed":
      return <Empty>No failed posts.</Empty>;
    case "posted":
      return <Empty>Nothing posted from Xtend yet.</Empty>;
  }
}

/**
 * Compose's landing page: one section of drafts (yours, queued, written for you by Library
 * and Automate, failed, posted) as a dense table. The section comes from the sidebar; a row
 * or New draft opens the composer.
 */
export function DraftsHome({
  tab,
  onOpen,
  onNew,
}: {
  readonly tab: ComposeTab;
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
  const costOf = useDraftCost();
  const [notice, setNotice] = useState<string | null>(null);

  const all = AsyncResult.getOrElse(drafts, () => [] as ReadonlyArray<Draft>);
  const shown = all.filter((d) => STATUSES[tab].includes(d.status));
  const asks = tab === "automatic" ? pending : [];
  const costs = shown.map(costOf);
  const total = costs.every((c) => c !== null) ? sumUsd(costs) : null;

  const report = (exit: Exit.Exit<unknown, unknown>, done: string) =>
    setNotice(Exit.isFailure(exit) ? `Failed: ${failText(exit.cause)}` : done);
  const act = async (what: RowAction, id: string) => {
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

  // The section's size and what posting all of it would cost.
  const count = shown.length + asks.length;
  const detail =
    count === 0
      ? undefined
      : tab === "posted" || total === null || total === 0
        ? `${count}`
        : `${count} · ${usd(total)}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sectionLabel("/compose", tab)}
        detail={detail}
        actions={
          <Button size="sm" onClick={onNew}>
            <Plus />
            New draft
          </Button>
        }
      />
      {notice !== null ? (
        <p
          role="status"
          className={cn(
            "shrink-0 border-b border-border px-6 py-2 text-xs",
            notice.startsWith("Failed") ? "text-error-foreground" : "text-muted-foreground",
          )}
        >
          {notice}
        </p>
      ) : null}
      <PageBody>
        {asks.length > 0 ? (
          <Table
            head={
              <>
                <th className={table.th}>Ask first</th>
                <th className={cn(table.th, "text-right")}>Asked</th>
                <th className={table.th} />
              </>
            }
          >
            {asks.map((r) => (
              <PendingRow key={r.id} request={r} onDecide={decide} />
            ))}
          </Table>
        ) : null}
        {AsyncResult.match(drafts, {
          onInitial: () => <Empty>Loading drafts</Empty>,
          onFailure: (f) => <Empty>{failText(f.cause)}</Empty>,
          onSuccess: () =>
            shown.length === 0 ? (
              asks.length > 0 ? null : (
                <EmptySection tab={tab} onNew={onNew} />
              )
            ) : (
              <Table
                head={
                  <>
                    <th className={table.th}>{tab === "automatic" ? "Suggested" : "Draft"}</th>
                    <th className={cn(table.th, "text-right")}>Posts</th>
                    {tab === "posted" ? null : <th className={cn(table.th, "text-right")}>Cost</th>}
                    <th className={cn(table.th, "text-right")}>{WHEN[tab]}</th>
                    <th className={table.th} />
                  </>
                }
              >
                {shown.map((d, i) => (
                  <DraftRow
                    key={d.id}
                    draft={d}
                    costUsd={costs[i] ?? null}
                    onOpen={onOpen}
                    onAct={act}
                  />
                ))}
              </Table>
            ),
        })}
      </PageBody>
    </div>
  );
}

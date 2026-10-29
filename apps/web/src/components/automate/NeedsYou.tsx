import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { PendingRequest, RuleRun } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import {
  approvePendingAtom,
  dismissPendingAtom,
  pendingAtom,
  runsAtom,
} from "../../state/automate";
import { usd } from "../../state/costs";
import { ErrorBar, errorText, when } from "../analyze/ui";
import { useAction } from "../leads/ui";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { Cost, Empty, PageBody } from "../ui/layout";
import { statusLabel, statusTone } from "./describe";
import { runsOf } from "./Rules";

/** Approvals that did not act (a budget skipped it, X refused it), one line under the header. */
function NotDone({
  runs,
  onOpenRuns,
}: {
  readonly runs: ReadonlyArray<RuleRun>;
  readonly onOpenRuns: () => void;
}) {
  const first = runs[0];
  if (first === undefined) return null;
  const why = `${statusLabel[first.status]}: ${first.detail}`;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-1.5 text-xs"
    >
      <p className={cn("min-w-0 flex-1 truncate", statusTone[first.status])} title={why}>
        {runs.length === 1 ? why : `${runs.length} not done, the first ${why}`}
      </p>
      <Button size="xs" variant="ghost" onClick={onOpenRuns}>
        Open runs
      </Button>
    </div>
  );
}

/** Ask-first requests. Approve performs the action at the price shown; Skip closes it for good. */
export function NeedsYou() {
  const pending = useAtomValue(pendingAtom);
  const refresh = useAtomRefresh(pendingAtom);
  const refreshRuns = useAtomRefresh(runsAtom);
  const approve = useAtomSet(approvePendingAtom, { mode: "promise" });
  const dismiss = useAtomSet(dismissPendingAtom, { mode: "promise" });
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  // The service settles an approved request whatever its run did, so only the run says it did not act.
  const [notDone, setNotDone] = useState<ReadonlyArray<RuleRun>>([]);
  const after = () => {
    refresh();
    refreshRuns();
  };
  const approveAll = (ids: ReadonlyArray<number>) =>
    void run(async () => {
      setNotDone([]);
      const runs: Array<RuleRun> = [];
      try {
        for (const id of ids) runs.push(await approve(id));
      } finally {
        setNotDone(runs.filter((r) => r.status !== "ok"));
        after();
      }
    });
  const requests = AsyncResult.getOrElse(pending, () => [] as ReadonlyArray<PendingRequest>);
  const total = requests.reduce((s, r) => s + r.costUsd, 0);
  const ruleIds = new Set(notDone.map((r) => r.ruleId));
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Needs you"
        detail={requests.length === 0 ? undefined : `${requests.length} waiting · ${usd(total)}`}
        actions={
          requests.length < 2 ? undefined : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || pending.waiting}
              onClick={() => approveAll(requests.map((r) => r.id))}
            >
              Approve all <Cost usd={total} />
            </Button>
          )
        }
      />
      <ErrorBar>{error}</ErrorBar>
      <NotDone
        runs={notDone}
        onOpenRuns={() =>
          void navigate({
            href:
              ruleIds.size === 1 ? runsOf(notDone[0]!.ruleId) : sectionHref("/automate", "runs"),
          })
        }
      />
      <PageBody className="@container">
        {AsyncResult.match(pending, {
          onInitial: () => <Empty>Connecting to the service.</Empty>,
          onFailure: (f) => (
            <Empty>
              <span className="text-error-foreground">{errorText(f.cause)}</span>
            </Empty>
          ),
          onSuccess: ({ value }) => (
            <NeedsYouList
              requests={value}
              // Until the refetch drops an approved request, its Approve would pay a second time.
              busy={busy || pending.waiting}
              onApprove={(id) => approveAll([id])}
              onDismiss={(id) => void run(() => dismiss(id).then(after))}
              onOpenRules={() => void navigate({ href: sectionHref("/automate", "rules") })}
            />
          ),
        })}
      </PageBody>
    </div>
  );
}

export function NeedsYouList({
  requests,
  busy,
  onApprove,
  onDismiss,
  onOpenRules,
}: {
  readonly requests: ReadonlyArray<PendingRequest>;
  readonly busy: boolean;
  readonly onApprove: (id: number) => void;
  readonly onDismiss: (id: number) => void;
  readonly onOpenRules?: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  // The card last acted on: once the refetch drops it, focus moves to the card now in its place.
  const acted = useRef<{ readonly id: number; readonly index: number } | null>(null);
  useEffect(() => {
    const card = acted.current;
    if (card === null || requests.some((r) => r.id === card.id)) return;
    acted.current = null;
    const cards = list.current?.children;
    if (cards !== undefined && cards.length > 0)
      (cards[Math.min(card.index, cards.length - 1)] as HTMLElement).focus();
  }, [requests]);
  const act = (r: PendingRequest, index: number, yes: boolean) => {
    acted.current = { id: r.id, index };
    (yes ? onApprove : onDismiss)(r.id);
  };

  if (requests.length === 0)
    return (
      <Empty
        action={
          onOpenRules === undefined ? undefined : (
            <Button size="sm" variant="outline" onClick={onOpenRules}>
              Open rules
            </Button>
          )
        }
      >
        Nothing waiting. Rules set to ask first queue their actions here.
      </Empty>
    );
  return (
    <ul ref={list} className="flex flex-col px-6 py-3" aria-label="Requests">
      {requests.map((r, i) => (
        // Focus a card and press a to approve or s to skip; the buttons do the same by click.
        <li
          key={r.id}
          tabIndex={0}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border py-3 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key !== "a" && e.key !== "s") return;
            // Taken here, so the shell's letter shortcuts (a is Analyze) leave it alone.
            e.preventDefault();
            if (!busy) act(r, i, e.key === "a");
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-foreground/90">{r.description}</p>
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
              {r.ruleName} · {when(r.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r, i, false)}>
              Skip
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(r, i, true)}>
              Approve <Cost usd={r.costUsd} />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

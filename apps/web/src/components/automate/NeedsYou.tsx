import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { PendingRequest } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

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

/** Ask-first requests. Approve performs the action at the price shown; Skip closes it for good. */
export function NeedsYou() {
  const pending = useAtomValue(pendingAtom);
  const refresh = useAtomRefresh(pendingAtom);
  const refreshRuns = useAtomRefresh(runsAtom);
  const approve = useAtomSet(approvePendingAtom, { mode: "promise" });
  const dismiss = useAtomSet(dismissPendingAtom, { mode: "promise" });
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const after = () => {
    refresh();
    refreshRuns();
  };
  const requests = AsyncResult.getOrElse(pending, () => [] as ReadonlyArray<PendingRequest>);
  const total = requests.reduce((s, r) => s + r.costUsd, 0);
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
              onClick={() =>
                void run(async () => {
                  for (const r of requests) await approve(r.id);
                  after();
                })
              }
            >
              Approve all <Cost usd={total} />
            </Button>
          )
        }
      />
      <ErrorBar>{error}</ErrorBar>
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
              onApprove={(id) => void run(() => approve(id).then(after))}
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
    <ul className="flex flex-col gap-2 px-6 py-5" aria-label="Requests">
      {requests.map((r) => (
        // Focus a card and press a to approve or s to skip; the buttons do the same by click.
        <li
          key={r.id}
          tabIndex={0}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 outline-hidden transition-colors duration-150 focus-visible:border-white/40"
          onKeyDown={(e) => {
            if (busy || e.target !== e.currentTarget) return;
            if (e.key === "a") onApprove(r.id);
            if (e.key === "s") onDismiss(r.id);
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-foreground/90">{r.description}</p>
            <p className="mt-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
              {r.ruleName} · {when(r.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(r.id)}>
              Skip
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove(r.id)}>
              Approve <Cost usd={r.costUsd} />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

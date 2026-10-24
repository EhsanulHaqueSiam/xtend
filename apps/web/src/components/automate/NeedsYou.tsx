import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { PendingRequest } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

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
import { Cost, Empty, PageBody, table } from "../ui/layout";

/** Ask-first requests. Approve performs the action at the price shown; Dismiss closes it for good. */
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
              busy={busy}
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
    <table className={table.root}>
      <thead>
        <tr>
          <th className={table.th}>Rule</th>
          <th className={table.th}>Request</th>
          <th className={cn(table.th, "hidden @2xl:table-cell")}>Queued</th>
          <th className={table.th}>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => (
          <tr key={r.id} className={table.row}>
            <td className={cn(table.td, "font-medium whitespace-nowrap")}>{r.ruleName}</td>
            <td className={cn(table.td, "w-full max-w-0")}>
              <p className="truncate text-foreground/90" title={r.description}>
                {r.description}
              </p>
            </td>
            <td
              className={cn(
                table.td,
                "hidden font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums @2xl:table-cell",
              )}
            >
              {when(r.createdAt)}
            </td>
            <td className={cn(table.td, "whitespace-nowrap")}>
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(r.id)}>
                  Dismiss
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => onApprove(r.id)}>
                  Approve <Cost usd={r.costUsd} />
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

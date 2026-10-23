import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { PendingRequest } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import {
  approvePendingAtom,
  dismissPendingAtom,
  pendingAtom,
  runsAtom,
} from "../../state/automate";
import { Empty, ErrorText, errorText, usd } from "../analyze/ui";
import { useAction } from "../leads/ui";
import { Button } from "../ui/button";

/** Ask-first requests. Approve performs the action at the cost shown; Dismiss closes it for good. */
export function NeedsYou() {
  const pending = useAtomValue(pendingAtom);
  const refresh = useAtomRefresh(pendingAtom);
  const refreshRuns = useAtomRefresh(runsAtom);
  const approve = useAtomSet(approvePendingAtom, { mode: "promise" });
  const dismiss = useAtomSet(dismissPendingAtom, { mode: "promise" });
  const { busy, error, run } = useAction();
  const after = () => {
    refresh();
    refreshRuns();
  };
  return (
    <>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {AsyncResult.match(pending, {
        onInitial: () => <Empty>Loading requests…</Empty>,
        onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
        onSuccess: ({ value }) => (
          <NeedsYouList
            requests={value}
            busy={busy}
            onApprove={(id) => void run(() => approve(id).then(after))}
            onDismiss={(id) => void run(() => dismiss(id).then(after))}
          />
        ),
      })}
    </>
  );
}

export function NeedsYouList({
  requests,
  busy,
  onApprove,
  onDismiss,
}: {
  readonly requests: ReadonlyArray<PendingRequest>;
  readonly busy: boolean;
  readonly onApprove: (id: number) => void;
  readonly onDismiss: (id: number) => void;
}) {
  if (requests.length === 0)
    return <Empty>Nothing needs you. Ask-first rules queue their actions here.</Empty>;
  return (
    <div className="rounded-lg border border-border bg-card px-3 text-xs">
      {requests.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2 border-t border-border py-2 first:border-t-0"
        >
          <span className="font-medium">{r.ruleName}</span>
          <span className="truncate text-muted-foreground">{r.description}</span>
          <span className="flex-1" />
          <span className="font-mono text-2xs text-muted-foreground">
            {r.createdAt.slice(0, 16).replace("T", " ")}
          </span>
          <Button size="xs" disabled={busy} onClick={() => onApprove(r.id)}>
            Approve ({usd(r.costUsd)})
          </Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => onDismiss(r.id)}>
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}

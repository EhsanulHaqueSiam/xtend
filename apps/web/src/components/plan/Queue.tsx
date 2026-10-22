import { useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { runsAtom } from "../../state/plan";
import { Empty, errorText } from "../analyze/ui";
import { draftTitle, fmtWhen, statusTone } from "../compose/DraftsList";
import { Button } from "../ui/button";
import { draftCostUsd, usd } from "./ui";

function Runs({ id }: { readonly id: string }) {
  const runs = useAtomValue(runsAtom(id));
  return AsyncResult.match(runs, {
    onInitial: () => <p className="text-2xs text-muted-foreground">Loading…</p>,
    onFailure: (f) => <p className="text-2xs text-error-foreground">{errorText(f.cause)}</p>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <p className="text-2xs text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 font-mono text-2xs">
          {value.map((r) => (
            <li key={r.id} className="flex gap-2">
              <span className="text-muted-foreground">{fmtWhen(r.at)}</span>
              <span className={r.ok ? "text-success-foreground" : "text-error-foreground"}>
                {r.ok ? "ok" : "failed"} #{r.attempt}
              </span>
              <span className="truncate text-muted-foreground">{r.detail}</span>
            </li>
          ))}
        </ul>
      ),
  });
}

/** Queued and failed drafts by time. Post now shows its treg cost before it charges. */
export function Queue({
  drafts,
  onSkip,
  onUnschedule,
  onRunNow,
  onOpen,
}: {
  readonly drafts: ReadonlyArray<Draft>;
  readonly onSkip: (id: string) => void;
  readonly onUnschedule: (id: string) => void;
  readonly onRunNow: (id: string) => void;
  readonly onOpen: (d: Draft) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (drafts.length === 0)
    return <Empty>Nothing queued. Add a draft from Compose or the shelf.</Empty>;
  return (
    <ul className="flex flex-col rounded-lg border border-border bg-card">
      {drafts.map((d) => (
        <li
          key={d.id}
          className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
        >
          <div className="flex items-center gap-2">
            <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(d)}>
              <p className="truncate text-sm">{draftTitle(d)}</p>
              <p className="flex gap-2 font-mono text-2xs text-muted-foreground">
                <span className={statusTone[d.status]}>{d.status}</span>
                <span>{d.scheduledAt === null ? "no time" : fmtWhen(d.scheduledAt)}</span>
                <span>{d.blocks.length} posts</span>
                <span>{usd(draftCostUsd(d))}</span>
                {d.attempts > 0 ? <span>{d.attempts} attempts</span> : null}
              </p>
            </button>
            <Button variant="ghost" size="xs" onClick={() => onSkip(d.id)}>
              Skip
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onUnschedule(d.id)}>
              Unschedule
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              Runs
            </Button>
            <Button
              size="xs"
              disabled={d.status !== "queued"}
              onClick={() => setConfirm(confirm === d.id ? null : d.id)}
            >
              Post now
            </Button>
          </div>
          {d.error !== null ? <p className="text-2xs text-error-foreground">{d.error}</p> : null}
          {confirm === d.id ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-2 py-1.5 text-xs">
              <span>
                Post {d.blocks.length} {d.blocks.length === 1 ? "post" : "posts"} now for{" "}
                {usd(draftCostUsd(d))}. This charges your treg balance.
              </span>
              <Button
                size="xs"
                onClick={() => {
                  setConfirm(null);
                  onRunNow(d.id);
                }}
              >
                Confirm and post
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
          {expanded === d.id ? <Runs id={d.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

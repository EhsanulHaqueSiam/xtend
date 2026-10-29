import { useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { runsAtom } from "../../state/plan";
import { failText } from "../compose/AssistPanel";
import { draftTitle, fmtWhen, useDraftCost } from "../compose/DraftsList";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import { Cost, Empty, table } from "../ui/layout";
import { StatusDot } from "./ui";

function Runs({ id }: { readonly id: string }) {
  const runs = useAtomValue(runsAtom(id));
  return AsyncResult.match(runs, {
    onInitial: () => <p className="text-2xs text-muted-foreground">Loading runs</p>,
    onFailure: (f) => <p className="text-2xs text-error-foreground">{failText(f.cause)}</p>,
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <p className="text-2xs text-muted-foreground">No runs yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 font-mono text-2xs tabular-nums">
          {value.map((r) => (
            <li key={r.id} className="flex gap-3">
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

/** Queued and failed drafts by time. Post now confirms with its treg price before it charges. */
export function Queue({
  drafts,
  busy,
  emptyAction,
  onSkip,
  onUnschedule,
  onRunNow,
  onOpen,
}: {
  readonly drafts: ReadonlyArray<Draft>;
  /** A draft action is in flight; the others wait for it. */
  readonly busy: boolean;
  /** What fills an empty queue, under its one line. */
  readonly emptyAction: ReactNode;
  readonly onSkip: (id: string) => void;
  readonly onUnschedule: (id: string) => void;
  readonly onRunNow: (id: string) => void;
  readonly onOpen: (d: Draft) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const costOf = useDraftCost();
  if (drafts.length === 0) return <Empty action={emptyAction}>Nothing queued.</Empty>;
  return (
    <table className={table.root}>
      <thead>
        <tr>
          <th className={table.th}>Posts at</th>
          <th className={cn(table.th, "w-full")}>Draft</th>
          <th className={cn(table.th, "text-right")}>Posts</th>
          <th className={cn(table.th, "text-right")}>Cost</th>
          <th className={table.th} />
        </tr>
      </thead>
      <tbody>
        {drafts.map((d) => {
          const cost = costOf(d);
          const media =
            d.media.length === 0
              ? null
              : d.media.some((m) => m.kind === "video")
                ? "video via session"
                : `${d.media.length} ${d.media.length === 1 ? "image" : "images"} via session`;
          return (
            <Fragment key={d.id}>
              <tr className={table.row}>
                <td className={cn(table.td, table.num, "whitespace-nowrap text-left")}>
                  <span className="flex items-center gap-2">
                    <StatusDot status={d.status} />
                    {d.status === "failed" ? (
                      <span className="text-error-foreground">failed</span>
                    ) : d.scheduledAt === null ? (
                      "no time"
                    ) : (
                      fmtWhen(d.scheduledAt)
                    )}
                  </span>
                </td>
                <td className={cn(table.td, "max-w-0 py-2")}>
                  <button
                    type="button"
                    className="block w-full cursor-pointer truncate text-left outline-hidden focus-visible:underline"
                    onClick={() => onOpen(d)}
                  >
                    {draftTitle(d)}
                  </button>
                  {d.error !== null ? (
                    <p className="truncate text-xs text-error-foreground">{d.error}</p>
                  ) : null}
                  {media !== null || d.attempts > 0 ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {[media, d.attempts > 0 ? `${d.attempts} attempts` : null]
                        .filter((x) => x !== null)
                        .join(" · ")}
                    </p>
                  ) : null}
                </td>
                <td className={cn(table.td, table.num, "text-muted-foreground")}>
                  {d.kind === "article" ? "article" : d.blocks.length}
                </td>
                <td className={cn(table.td, "text-right")}>
                  {cost === null ? <Cost label="…" /> : <Cost usd={cost} />}
                </td>
                <td className={cn(table.td, "w-px")}>
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => onSkip(d.id)}>
                      Skip
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() => onUnschedule(d.id)}
                    >
                      Unschedule
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-expanded={expanded === d.id}
                      onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    >
                      Runs
                    </Button>
                    <Popover
                      open={confirm === d.id}
                      onOpenChange={(open) => setConfirm(open ? d.id : null)}
                      trigger={
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy || cost === null || d.status !== "queued"}
                        >
                          Post now
                        </Button>
                      }
                    >
                      <p>
                        {d.kind === "article"
                          ? "Publish this article"
                          : `Post ${d.blocks.length} ${d.blocks.length === 1 ? "post" : "posts"}`}{" "}
                        now for {cost === null ? "…" : <Cost usd={cost} />}.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Charges your treg balance.
                      </p>
                      <div className="mt-3 flex justify-end gap-1.5">
                        <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="xs"
                          disabled={cost === null}
                          onClick={() => {
                            setConfirm(null);
                            onRunNow(d.id);
                          }}
                        >
                          Confirm and post
                        </Button>
                      </div>
                    </Popover>
                  </div>
                </td>
              </tr>
              {expanded === d.id ? (
                <tr>
                  <td colSpan={5} className="border-b border-border px-6 py-2.5">
                    <Runs id={d.id} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

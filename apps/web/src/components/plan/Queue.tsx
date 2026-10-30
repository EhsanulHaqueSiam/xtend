import { useAtomValue } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Ellipsis } from "lucide-react";
import { useState, type ReactNode } from "react";

import { runsAtom } from "../../state/plan";
import { failText } from "../compose/AssistPanel";
import { draftTitle, fmtWhen, useDraftCost } from "../compose/DraftsList";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import { Cost, Empty } from "../ui/layout";
import { Menu, MenuItem } from "../ui/menu";
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

/** Queued and failed drafts by time. Post now shows its treg price and confirms before it charges; the rest wait behind ⋯. */
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
  // The only price here is Post now's, and Post now is a click.
  const costOf = useDraftCost(true);
  if (drafts.length === 0) return <Empty action={emptyAction}>Nothing queued.</Empty>;
  return (
    <ul>
      {drafts.map((d) => {
        const cost = costOf(d);
        const media =
          d.media.length === 0
            ? null
            : d.media.some((m) => m.kind === "video")
              ? "video via session"
              : `${d.media.length} ${d.media.length === 1 ? "image" : "images"} via session`;
        const meta = [
          d.status === "failed"
            ? null
            : d.scheduledAt === null
              ? "no time"
              : fmtWhen(d.scheduledAt),
          d.kind === "article"
            ? "article"
            : `${d.blocks.length} ${d.blocks.length === 1 ? "post" : "posts"}`,
          media,
          d.attempts > 0 ? `${d.attempts} attempts` : null,
        ].filter((x) => x !== null);
        return (
          <li key={d.id} className="border-b border-border">
            {/* Two lines, so the title keeps the width at any panel size: it first, then when and what. */}
            <div className="flex items-center gap-2 py-2 pr-4 pl-6 transition-colors duration-150 hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block w-full cursor-pointer truncate text-left text-[13px] outline-hidden focus-visible:underline"
                  onClick={() => onOpen(d)}
                >
                  {draftTitle(d)}
                </button>
                <p className="flex min-w-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground tabular-nums">
                  <StatusDot status={d.status} />
                  {d.status === "failed" ? (
                    <span className="shrink-0 text-error-foreground">failed ·</span>
                  ) : null}
                  {/* A failed row says why on its second line, so every row stays two lines. */}
                  {d.status === "failed" && d.error !== null ? (
                    <span className="truncate text-error-foreground" title={d.error}>
                      {d.error}
                    </span>
                  ) : (
                    <span className="truncate">{meta.join(" · ")}</span>
                  )}
                </p>
                {d.error !== null && d.status !== "failed" ? (
                  <p className="truncate text-xs text-error-foreground">{d.error}</p>
                ) : null}
              </div>
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
                    {cost === null ? <Cost label="…" /> : <Cost usd={cost} />}
                  </Button>
                }
              >
                <p>
                  {d.kind === "article"
                    ? "Publish this article"
                    : `Post ${d.blocks.length} ${d.blocks.length === 1 ? "post" : "posts"}`}{" "}
                  now for {cost === null ? "…" : <Cost usd={cost} />}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Charges your treg balance.</p>
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
              <Menu
                align="end"
                label="Draft actions"
                trigger={
                  <Button variant="ghost" size="icon-xs" aria-label="More actions">
                    <Ellipsis />
                  </Button>
                }
              >
                <MenuItem disabled={busy} onClick={() => onSkip(d.id)}>
                  Skip this slot
                </MenuItem>
                <MenuItem disabled={busy} onClick={() => onUnschedule(d.id)}>
                  Unschedule
                </MenuItem>
                <MenuItem onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  {expanded === d.id ? "Hide runs" : "Runs"}
                </MenuItem>
              </Menu>
            </div>
            {expanded === d.id ? (
              <div className="px-6 pb-2.5">
                <Runs id={d.id} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

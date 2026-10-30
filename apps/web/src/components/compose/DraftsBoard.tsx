import { useAtomSet } from "@effect/atom-react";
import type { Draft } from "@xtend/contracts";
import { useState } from "react";

import { DRAFT_TYPE } from "../../lib/drag";
import { cn } from "../../lib/utils";
import { updateDraftAtom } from "../../state/compose";
import { queueAtom, unscheduleAtom } from "../../state/plan";
import { errorMessage } from "../library/shared";
import { Cost } from "../ui/layout";
import { toastAtom } from "../ui/toast";
import { draftTitle, fmtWhen } from "./DraftsList";

/** The board's columns are the draft statuses the user moves between; the service owns the rest. */
const COLUMNS = [
  { id: "suggested", label: "Automatic", takes: true },
  { id: "draft", label: "Drafts", takes: true },
  { id: "queued", label: "Queued", takes: true },
  { id: "posted", label: "Posted", takes: false },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];

const columnOf = (status: Draft["status"]): ColumnId =>
  status === "posting" ? "queued" : status === "failed" ? "draft" : status;

const when = (d: Draft) =>
  d.status === "queued" && d.scheduledAt !== null
    ? fmtWhen(d.scheduledAt)
    : d.status === "posted" && d.postedAt !== null
      ? fmtWhen(d.postedAt)
      : fmtWhen(d.updatedAt);

/**
 * Drafts as columns: Automatic, Drafts, Queued, Posted. Dragging a card right
 * advances it (a suggestion becomes yours, a draft queues at the next slot);
 * dragging a queued one back unschedules it. Each move is one toast with Undo.
 */
export function DraftsBoard({
  drafts,
  costOf,
  onOpen,
  onChanged,
}: {
  readonly drafts: ReadonlyArray<Draft>;
  readonly costOf: (d: Draft) => number | null;
  readonly onOpen: (id: string) => void;
  readonly onChanged: () => void;
}) {
  const queue = useAtomSet(queueAtom, { mode: "promise" });
  const unschedule = useAtomSet(unscheduleAtom, { mode: "promise" });
  const update = useAtomSet(updateDraftAtom, { mode: "promise" });
  const setToast = useAtomSet(toastAtom);
  const [over, setOver] = useState<ColumnId | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const move = async (draft: Draft, to: ColumnId) => {
    const from = columnOf(draft.status);
    if (from === to) return;
    const done = () => onChanged();
    if (to === "queued") {
      // Queueing a paid post waits for its price.
      if (costOf(draft) === null) return setToast({ text: "Its price is not known yet" });
      await queue(draft.id);
      done();
      setToast({ text: "Queued for the next slot", undo: () => unschedule(draft.id).then(done) });
    } else if (to === "draft" && from === "queued") {
      await unschedule(draft.id);
      done();
      setToast({ text: "Back in drafts", undo: () => queue(draft.id).then(done) });
    } else if (to === "draft" && from === "suggested") {
      await update({ id: draft.id, patch: { status: "draft" } });
      done();
      setToast({
        text: "Now one of your drafts",
        undo: () => update({ id: draft.id, patch: { status: "suggested" } }).then(done),
      });
    } else if (to === "suggested" && from === "draft") {
      await update({ id: draft.id, patch: { status: "suggested" } });
      done();
      setToast({
        text: "Back to Automatic",
        undo: () => update({ id: draft.id, patch: { status: "draft" } }).then(done),
      });
    } else {
      setToast({ text: "A queued draft goes back to Drafts first" });
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4 px-6 py-5 @3xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const cards = drafts.filter((d) => columnOf(d.status) === column.id);
        return (
          <section
            key={column.id}
            data-over={over === column.id || undefined}
            className={cn(
              "flex min-h-40 flex-col gap-2 rounded-2xl border border-border bg-card p-3 transition-colors duration-150",
              column.takes && dragging !== null && "border-white/15",
              over === column.id && "border-white/40",
            )}
            onDragOver={
              column.takes
                ? (event) => {
                    if (!event.dataTransfer.types.includes(DRAFT_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (over !== column.id) setOver(column.id);
                  }
                : undefined
            }
            onDragLeave={() => setOver((o) => (o === column.id ? null : o))}
            onDrop={
              column.takes
                ? (event) => {
                    event.preventDefault();
                    setOver(null);
                    const id = event.dataTransfer.getData(DRAFT_TYPE);
                    const draft = drafts.find((d) => d.id === id);
                    if (draft !== undefined)
                      void move(draft, column.id).catch((e: unknown) =>
                        setToast({ text: errorMessage(e) }),
                      );
                  }
                : undefined
            }
          >
            <h3 className="flex items-baseline gap-2 px-1 text-xs font-semibold text-muted-foreground">
              {column.label}
              <span className="font-mono text-2xs font-normal tabular-nums">{cards.length}</span>
            </h3>
            {cards.map((d) => {
              const cost = costOf(d);
              const editable = d.status !== "posted" && d.status !== "posting";
              return (
                <button
                  key={d.id}
                  type="button"
                  draggable={editable}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-xl border border-border bg-background px-3 py-2 text-left outline-hidden transition-[border-color,opacity] duration-150 hover:border-white/15 focus-visible:ring-2 focus-visible:ring-ring",
                    editable && "cursor-grab active:cursor-grabbing",
                    dragging === d.id && "opacity-40",
                  )}
                  onClick={() => (editable ? onOpen(d.id) : undefined)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAFT_TYPE, d.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(d.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <span className="truncate text-[13px]">{draftTitle(d)}</span>
                  <span className="flex items-center gap-2 font-mono text-2xs whitespace-nowrap text-muted-foreground tabular-nums">
                    <span>
                      {d.kind === "article"
                        ? "article"
                        : `${d.blocks.length} post${d.blocks.length === 1 ? "" : "s"}`}
                    </span>
                    {d.status === "failed" ? (
                      <span className="text-error-foreground">failed</span>
                    ) : null}
                    <span className="ml-auto truncate">{when(d)}</span>
                    {d.status === "posted" || cost === null ? null : <Cost usd={cost} />}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

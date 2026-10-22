import type { Draft } from "@xtend/contracts";
import { Trash2 } from "lucide-react";

import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export { fmtWhen };

export const draftTitle = (d: Draft) =>
  (d.kind === "article" ? d.title : (d.blocks[0]?.text ?? "")).split("\n")[0]?.trim() || "Untitled";


export const statusTone: Record<Draft["status"], string> = {
  draft: "text-muted-foreground",
  queued: "text-info-foreground",
  posting: "text-info-foreground",
  posted: "text-success-foreground",
  failed: "text-error-foreground",
  suggested: "text-warning-foreground",
};

export function DraftsList({
  drafts,
  selectedId,
  onOpen,
  onDelete,
}: {
  readonly drafts: ReadonlyArray<Draft>;
  readonly selectedId: string | null;
  readonly onOpen: (draft: Draft) => void;
  readonly onDelete: (id: string) => void;
}) {
  if (drafts.length === 0)
    return <p className="px-3 py-4 text-2xs text-muted-foreground">No drafts yet.</p>;
  return (
    <ul className="flex flex-col">
      {drafts.map((d) => (
        <li
          key={d.id}
          className={cn(
            "group flex items-start gap-1 border-b border-border px-2 py-2 hover:bg-accent/60",
            d.id === selectedId && "bg-accent/60",
          )}
        >
          <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(d)}>
            <p className="truncate text-sm">{draftTitle(d)}</p>
            <p className="mt-0.5 flex gap-2 font-mono text-2xs text-muted-foreground">
              <span className={statusTone[d.status]}>{d.status}</span>
              <span>{fmtWhen(d.updatedAt)}</span>
              {d.kind === "article" ? <span>article</span> : null}
            </p>
          </button>
          <Button
            variant="ghost-destructive"
            size="icon-xs"
            aria-label="Delete draft"
            className="opacity-0 group-hover:opacity-100"
            onClick={() => onDelete(d.id)}
          >
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}

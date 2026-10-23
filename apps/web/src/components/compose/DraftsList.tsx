import type { Draft } from "@xtend/contracts";
import { fmtWhen } from "../../lib/time";

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

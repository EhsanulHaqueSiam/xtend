import type { Draft, Slot } from "@xtend/contracts";

import { cn } from "../../lib/utils";

export { hhmm } from "../../lib/time";

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const slotsOn = (slots: ReadonlyArray<Slot>, weekday: number) =>
  slots.filter((s) => (s.weekdayMask & (1 << weekday)) !== 0);

const DOT: Record<Draft["status"], string> = {
  draft: "bg-muted-foreground",
  suggested: "bg-warning-foreground",
  queued: "bg-info-foreground",
  posting: "bg-info-foreground",
  posted: "bg-success-foreground",
  failed: "bg-error-foreground",
};

/** A draft's status as a 6px dot, beside a time or a title. */
export function StatusDot({ status }: { readonly status: Draft["status"] }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[status])} />;
}

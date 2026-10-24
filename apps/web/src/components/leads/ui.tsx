import type { Stage } from "@xtend/contracts";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";

export const STAGES: ReadonlyArray<Stage> = ["new", "contacted", "replied", "customer", "ignored"];

const stageTone = (stage: Stage) =>
  stage === "replied" || stage === "customer"
    ? "text-success-foreground"
    : stage === "ignored"
      ? "text-muted-foreground line-through"
      : "text-muted-foreground";

/** A stage as a word: green once they answered, struck through when ignored. */
export function StageText({ stage }: { readonly stage: Stage }) {
  return <span className={cn("font-mono text-xs", stageTone(stage))}>{stage}</span>;
}

/** Busy flag plus the last error for a button that awaits an rpc atom in promise mode. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** A field in a detail column's form: its label on the left, the control on the right. */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 py-1">
      {/* Level with the first line of the control beside it. */}
      <span className="pt-2 text-[12.5px] leading-5 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Compact inputs for the detail column. */
export const field =
  "w-full rounded-[var(--control-radius)] border border-white/13 bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-hidden transition-[border-color] duration-150 placeholder:text-placeholder focus:border-white/30";

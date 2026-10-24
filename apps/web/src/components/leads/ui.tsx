import type { Stage } from "@xtend/contracts";
import { useState } from "react";

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

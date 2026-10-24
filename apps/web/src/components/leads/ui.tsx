import type { RateCard, SignalAgentInput, Stage } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { usd } from "../../state/costs";

export const STAGES: ReadonlyArray<Stage> = ["new", "contacted", "replied", "customer", "ignored"];

/** "3m", "2h", "5d": the table is dense, so no words. */
export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export function StagePill({ stage }: { readonly stage: Stage }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1 font-mono text-2xs",
        stage === "replied" || stage === "customer"
          ? "border-success/40 text-success-foreground"
          : stage === "ignored"
            ? "border-border text-muted-foreground line-through"
            : "border-border text-muted-foreground",
      )}
    >
      {stage}
    </span>
  );
}

/** The price of one agent run: a search page, plus a profile per new author when it drops bots. */
export const agentRunCost = (
  rates: RateCard | null,
  agent: Pick<SignalAgentInput, "excludeBots">,
) =>
  rates === null
    ? "…"
    : agent.excludeBots
      ? // SignalAgents reads one 50-post search page, so at most 50 new authors.
        `up to ${usd(rates.searchPage + 50 * rates.scraperProfile)}`
      : usd(rates.searchPage);

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

import type { RateCard, SignalAgentInput, Stage, Tier } from "@xtend/contracts";
import { useState } from "react";

import { cn, readableError } from "../../lib/utils";
import { usd } from "../../state/costs";

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

// Bands from PeopleStore.tierOf: the Scores tiers, scaled to the 0-100 person score.
const TIER_SCALE =
  "Tier from the 0-100 score: Supreme 90+, Significant 60+, Credible 40+, Noted 20+, Unknown below. The score counts followers on a log scale, plus verified and a bio.";

/** A tier word that explains the scale on hover. */
export function TierText({ tier }: { readonly tier: Tier | null }) {
  return tier === null ? null : (
    <span title={TIER_SCALE} className="cursor-help">
      {tier}
    </span>
  );
}

/**
 * The price of one agent run: a search page, plus a profile per new author when it drops bots,
 * plus the model call that scores what it found (`assist`, the assist quote's label).
 */
export const agentRunCost = (
  rates: RateCard | null,
  assist: string,
  agent: Pick<SignalAgentInput, "excludeBots">,
) =>
  rates === null
    ? "…"
    : `${
        agent.excludeBots
          ? // SignalAgents reads one 50-post search page, so at most 50 new authors.
            `up to ${usd(rates.searchPage + 50 * rates.scraperProfile)}`
          : usd(rates.searchPage)
      }${assist === "free" ? "" : ` + ${assist}`}`;

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
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

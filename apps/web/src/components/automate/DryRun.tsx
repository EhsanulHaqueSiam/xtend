import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { DryRunReport, Rule, RulePreview } from "@xtend/contracts";
import { useState } from "react";

import { fmtWhen } from "../../lib/time";
import { cn } from "../../lib/utils";
import { dryRun7dAtom, previewAtom } from "../../state/automate";
import { Empty, ErrorText, inputClass, usd } from "../analyze/ui";
import { Button } from "../ui/button";

/** What every enabled rule would do right now, and what one rule would have done over the last 7 days. */
export function DryRun({ rules }: { readonly rules: ReadonlyArray<Rule> }) {
  const preview = useAtomSet(previewAtom, { mode: "promise" });
  const state = useAtomValue(previewAtom);
  const simulate = useAtomSet(dryRun7dAtom, { mode: "promise" });
  const [rows, setRows] = useState<ReadonlyArray<RulePreview> | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // Follows the list: rules can arrive, or the picked one be deleted, while the tab is open.
  const ruleId = rules.some((r) => r.id === picked) ? picked : (rules[0]?.id ?? null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const total = rows?.reduce((s, r) => s + r.costUsd, 0) ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <Button
          size="xs"
          variant="outline"
          disabled={state.waiting}
          onClick={() => void guard(async () => setRows(await preview()))}
        >
          {state.waiting ? "Evaluating…" : "Evaluate enabled rules"}
        </Button>
        <span className="text-muted-foreground">
          Lists what would fire right now with its cost. Reads stored data only: free, fires
          nothing.
        </span>
      </div>
      {error !== null ? <ErrorText>{error}</ErrorText> : null}
      {rows === null ? null : rows.length === 0 ? (
        <Empty>Nothing would fire right now.</Empty>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">Rule</th>
              <th className="py-1 text-left font-normal">Would</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.ruleId}-${r.subjectId}`} className="border-t border-border">
                <td className="py-1 pr-2 whitespace-nowrap">{r.ruleName}</td>
                <td className="py-1 pr-2">{r.description}</td>
                <td className="py-1 text-right font-mono">{usd(r.costUsd)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className="py-1" colSpan={2}>
                {rows.length} would fire
              </td>
              <td className="py-1 text-right font-mono">{usd(total)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-3 text-xs">
        <select
          className={cn(inputClass, "w-auto")}
          value={ruleId ?? ""}
          onChange={(e) => setPicked(Number(e.target.value))}
        >
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="outline"
          disabled={ruleId === null}
          onClick={() => void guard(async () => setReport(await simulate(ruleId!)))}
        >
          Simulate last 7 days
        </Button>
        <span className="text-muted-foreground">
          Replays the rule over stored posts, engagers and followers. Free.
        </span>
      </div>
      {report === null ? null : report.fired.length === 0 ? (
        <Empty>Would not have fired in the last 7 days.</Empty>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">When</th>
              <th className="py-1 text-left font-normal">Would have</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {report.fired.map((f) => (
              <tr key={`${f.at} ${f.description}`} className="border-t border-border">
                <td className="py-1 pr-2 font-mono whitespace-nowrap text-muted-foreground">
                  {fmtWhen(f.at)}
                </td>
                <td className="py-1 pr-2">{f.description}</td>
                <td className="py-1 text-right font-mono">{usd(f.costUsd)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className="py-1" colSpan={2}>
                {report.fired.length} firings in 7 days
              </td>
              <td className="py-1 text-right font-mono">{usd(report.totalUsd)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

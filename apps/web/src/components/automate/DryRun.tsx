import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { RulePreview } from "@xtend/contracts";
import { useState } from "react";

import { Empty, ErrorText, usd } from "../analyze/ui";
import { Button } from "../ui/button";
import { previewAtom } from "../../state/automate";

/** What every enabled rule would do right now. Nothing fires, nothing is charged. */
export function DryRun() {
  const preview = useAtomSet(previewAtom, { mode: "promise" });
  const state = useAtomValue(previewAtom);
  const [rows, setRows] = useState<ReadonlyArray<RulePreview> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    try {
      setRows(await preview());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const total = rows?.reduce((s, r) => s + r.costUsd, 0) ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <Button size="xs" variant="outline" disabled={state.waiting} onClick={() => void run()}>
          {state.waiting ? "Evaluating…" : "Evaluate enabled rules"}
        </Button>
        <span className="text-muted-foreground">
          Lists what would fire right now with its cost. Fires nothing.
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
    </div>
  );
}

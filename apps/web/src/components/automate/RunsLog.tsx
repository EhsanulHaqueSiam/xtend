import { RuleRunStatus, type Rule, type RuleRun } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Empty, inputClass, usd } from "../analyze/ui";
import { statusTone } from "./describe";

const STATUSES = RuleRunStatus.literals;

export function RunsLog({
  runs,
  rules,
}: {
  readonly runs: ReadonlyArray<RuleRun>;
  readonly rules: ReadonlyArray<Rule>;
}) {
  const [status, setStatus] = useState<RuleRunStatus | "">("");
  const [ruleId, setRuleId] = useState<number | null>(null);
  const names = new Map(rules.map((r) => [r.id, r.name]));
  const shown = runs.filter(
    (r) => (status === "" || r.status === status) && (ruleId === null || r.ruleId === ruleId),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 text-xs">
        <select
          className={cn(inputClass, "w-auto")}
          value={ruleId ?? ""}
          onChange={(e) => setRuleId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">All rules</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          className={cn(inputClass, "w-auto")}
          value={status}
          onChange={(e) => setStatus(e.target.value as RuleRunStatus | "")}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <Empty>No runs yet. Enable a rule or press Run now.</Empty>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-2xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">When</th>
              <th className="py-1 text-left font-normal">Rule</th>
              <th className="py-1 text-left font-normal">Status</th>
              <th className="py-1 text-left font-normal">Detail</th>
              <th className="py-1 text-left font-normal">Subject</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-border align-top hover:bg-accent/60">
                <td className="py-1 pr-2 font-mono whitespace-nowrap text-muted-foreground">
                  {r.at.slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-1 pr-2 whitespace-nowrap">
                  {names.get(r.ruleId) ?? `#${r.ruleId}`}
                </td>
                <td className={"py-1 pr-2 " + statusTone[r.status]}>{r.status}</td>
                <td
                  className={"py-1 pr-2 " + (r.status === "failed" ? "text-error-foreground" : "")}
                >
                  {r.detail}
                </td>
                <td className="max-w-40 truncate py-1 pr-2 font-mono text-muted-foreground">
                  {r.subjectId}
                </td>
                <td className="py-1 text-right font-mono">{usd(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

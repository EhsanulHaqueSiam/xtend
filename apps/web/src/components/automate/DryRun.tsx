import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { DryRunReport, Rule, RulePreview } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { dryRun7dAtom, previewAtom, rulesAtom } from "../../state/automate";
import { usd } from "../../state/costs";
import { ErrorBar, insetTable, Note, when } from "../analyze/ui";
import { compactInputClass } from "../ui/field";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { Cost, PageBody, Section } from "../ui/layout";

/** Rows of what would fire, each with its price, and the total. */
function WouldFire({
  rows,
  first,
  total,
  summary,
}: {
  readonly rows: ReadonlyArray<{ key: string; first: string; description: string; usd: number }>;
  readonly first: string;
  readonly total: number;
  readonly summary: string;
}) {
  const t = insetTable;
  return (
    <table className={t.root}>
      <thead>
        <tr>
          <th className={t.th}>{first}</th>
          <th className={t.th}>Would</th>
          <th className={cn(t.th, "text-right")}>Price</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className={t.row}>
            <td className={cn(t.td, "whitespace-nowrap")}>{r.first}</td>
            <td className={cn(t.td, "w-full max-w-0")}>
              <p className="truncate text-foreground/90" title={r.description}>
                {r.description}
              </p>
            </td>
            <td className={cn(t.td, t.num)}>{usd(r.usd)}</td>
          </tr>
        ))}
        <tr>
          <td className={cn(t.td, "border-b-0 font-medium")} colSpan={2}>
            {summary}
          </td>
          <td className={cn(t.td, t.num, "border-b-0 font-medium")}>{usd(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** What every enabled rule would do right now, and what one rule would have done over the last 7 days. */
export function DryRun() {
  const rules = AsyncResult.getOrElse(useAtomValue(rulesAtom), () => [] as ReadonlyArray<Rule>);
  const preview = useAtomSet(previewAtom, { mode: "promise" });
  const previewState = useAtomValue(previewAtom);
  const simulate = useAtomSet(dryRun7dAtom, { mode: "promise" });
  const simulateState = useAtomValue(dryRun7dAtom);
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReadonlyArray<RulePreview> | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Follows the list: rules can arrive, or the picked one be deleted, while the page is open.
  const ruleId = rules.some((r) => r.id === picked) ? picked : (rules[0]?.id ?? null);
  const guard = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const enabled = rules.filter((r) => r.enabled).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Dry run" detail="reads stored data only, fires nothing" />
      <ErrorBar>{error}</ErrorBar>
      <PageBody>
        <Section
          title="Right now"
          aside={
            <Button
              size="sm"
              variant="outline"
              disabled={previewState.waiting || enabled === 0}
              onClick={() => void guard(async () => setRows(await preview()))}
            >
              <TextMorph duration={250}>
                {previewState.waiting ? "Evaluating" : `Evaluate ${enabled} enabled`}
              </TextMorph>
              <Cost usd={0} />
            </Button>
          }
        >
          {rows === null ? (
            <Note>
              {enabled === 0
                ? "No rule is on. Turn one on to see what it would fire."
                : "What every enabled rule would fire now, each with its price."}
            </Note>
          ) : rows.length === 0 ? (
            <Note>Nothing would fire right now.</Note>
          ) : (
            <WouldFire
              first="Rule"
              rows={rows.map((r) => ({
                key: `${r.ruleId}-${r.subjectId}`,
                first: r.ruleName,
                description: r.description,
                usd: r.costUsd,
              }))}
              total={rows.reduce((s, r) => s + r.costUsd, 0)}
              summary={`${rows.length} would fire`}
            />
          )}
        </Section>

        <Section
          title="Last 7 days"
          aside={
            rules.length === 0 ? undefined : (
              <>
                <select
                  aria-label="Rule"
                  className={cn(compactInputClass, "w-48")}
                  value={ruleId ?? ""}
                  onChange={(e) => {
                    setPicked(Number(e.target.value));
                    setReport(null);
                  }}
                >
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ruleId === null || simulateState.waiting}
                  onClick={() =>
                    ruleId !== null && void guard(async () => setReport(await simulate(ruleId)))
                  }
                >
                  <TextMorph duration={250}>
                    {simulateState.waiting ? "Simulating" : "Simulate"}
                  </TextMorph>
                  <Cost usd={0} />
                </Button>
              </>
            )
          }
        >
          {rules.length === 0 ? (
            <Note
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigate({ href: sectionHref("/automate", "rules") })}
                >
                  Open rules
                </Button>
              }
            >
              No rules yet.
            </Note>
          ) : report === null ? (
            <Note>Replays one rule over stored posts, engagers and followers.</Note>
          ) : report.fired.length === 0 ? (
            <Note>Would not have fired in the last 7 days.</Note>
          ) : (
            <WouldFire
              first="When"
              rows={report.fired.map((f) => ({
                key: `${f.at} ${f.description}`,
                first: when(f.at),
                description: f.description,
                usd: f.costUsd,
              }))}
              total={report.totalUsd}
              summary={`${report.fired.length} firings in 7 days`}
            />
          )}
        </Section>
      </PageBody>
    </div>
  );
}

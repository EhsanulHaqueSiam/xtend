import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { DryRunReport, RulePreview } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";
import { TextMorph } from "torph/react";

import { cn } from "../../lib/utils";
import { dryRun7dAtom, previewAtom, rulesAtom } from "../../state/automate";
import { usd } from "../../state/costs";
import { ErrorBar, errorText, insetTable, Note, when } from "../analyze/ui";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { Cost, PageBody, Section } from "../ui/layout";
import { Select } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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
              <Tooltip>
                <TooltipTrigger render={<p className="truncate text-foreground/90" />}>
                  {r.description}
                </TooltipTrigger>
                <TooltipPopup>{r.description}</TooltipPopup>
              </Tooltip>
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
export function DryRun({ tabs }: { readonly tabs?: ReactNode }) {
  const rulesResult = useAtomValue(rulesAtom);
  // null until the list loads: a list that failed to load is not "no rules".
  const loaded = AsyncResult.getOrElse(rulesResult, () => null);
  const rules = loaded ?? [];
  const notLoaded = AsyncResult.isFailure(rulesResult) ? "Rules did not load." : "Loading rules.";
  const preview = useAtomSet(previewAtom, { mode: "promise" });
  const previewState = useAtomValue(previewAtom);
  const simulate = useAtomSet(dryRun7dAtom, { mode: "promise" });
  const simulateState = useAtomValue(dryRun7dAtom);
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReadonlyArray<RulePreview> | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // Tagged with its rule: a simulation still running when another rule is picked lands under its own.
  const [simulated, setSimulated] = useState<{
    readonly ruleId: number;
    readonly report: DryRunReport;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Follows the list: rules can arrive, or the picked one be deleted, while the page is open.
  const ruleId = rules.some((r) => r.id === picked) ? picked : (rules[0]?.id ?? null);
  const report = simulated !== null && simulated.ruleId === ruleId ? simulated.report : null;
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
      <PageHeader title="Rules" tabs={tabs} detail="reads stored data only, fires nothing" />
      <ErrorBar>
        {error ?? (AsyncResult.isFailure(rulesResult) ? errorText(rulesResult.cause) : null)}
      </ErrorBar>
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
              {loaded === null
                ? notLoaded
                : enabled === 0
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
                <Select
                  compact
                  label="Rule"
                  className="w-48"
                  value={ruleId}
                  onChange={setPicked}
                  options={rules.map((r) => ({ value: r.id, label: r.name }))}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ruleId === null || simulateState.waiting}
                  onClick={() =>
                    ruleId !== null &&
                    void guard(async () => setSimulated({ ruleId, report: await simulate(ruleId) }))
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
          {loaded === null ? (
            <Note>{notLoaded}</Note>
          ) : rules.length === 0 ? (
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

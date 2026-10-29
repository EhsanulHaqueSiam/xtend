import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { RuleRunStatus, type Rule, type RuleRun } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { rulesAtom, runsAtom } from "../../state/automate";
import { usd } from "../../state/costs";
import { errorText, when } from "../analyze/ui";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { Empty, PageBody, table } from "../ui/layout";
import { statusLabel, statusTone } from "./describe";
import { Select } from "../ui/select";

type StatusFilter = RuleRunStatus | "all";

/** The runs log, newest first and capped by the service. `?rule=` opens it on one rule. */
export function Runs() {
  const runs = useAtomValue(runsAtom);
  const rules = AsyncResult.getOrElse(useAtomValue(rulesAtom), () => [] as ReadonlyArray<Rule>);
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const linked = Number(new URLSearchParams(searchStr).get("rule"));
  const linkedId = Number.isInteger(linked) && linked > 0 ? linked : null;
  return AsyncResult.match(runs, {
    onInitial: () => (
      <RunsPage>
        <Empty>Connecting to the service.</Empty>
      </RunsPage>
    ),
    onFailure: (f) => (
      <RunsPage>
        <Empty>
          <span className="text-error-foreground">{errorText(f.cause)}</span>
        </Empty>
      </RunsPage>
    ),
    onSuccess: ({ value }) => (
      // Keyed so following another rule's "Runs" link resets the filter to it.
      <RunsLog key={linkedId ?? "all"} runs={value} rules={rules} initialRuleId={linkedId} />
    ),
  });
}

function RunsPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Runs" />
      <PageBody>{children}</PageBody>
    </div>
  );
}

function RunsLog({
  runs,
  rules,
  initialRuleId = null,
}: {
  readonly runs: ReadonlyArray<RuleRun>;
  readonly rules: ReadonlyArray<Rule>;
  readonly initialRuleId?: number | null;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [ruleId, setRuleId] = useState<number | null>(initialRuleId);
  const navigate = useNavigate();
  const names = new Map(rules.map((r) => [r.id, r.name]));
  const ofRule = runs.filter((r) => ruleId === null || r.ruleId === ruleId);
  const shown = ofRule.filter((r) => status === "all" || r.status === status);
  const total = shown.reduce((s, r) => s + r.costUsd, 0);
  // Only the statuses this log has, so the header stays one short row.
  const tabs = [
    { id: "all" as const, label: "All" },
    ...RuleRunStatus.literals
      .map((s) => ({
        id: s,
        label: s === "ok" ? "OK" : statusLabel[s].charAt(0).toUpperCase() + statusLabel[s].slice(1),
        count: ofRule.filter((r) => r.status === s).length,
      }))
      .filter((t) => t.count > 0 || t.id === status),
  ];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Runs"
        tabs={<HeaderTabs label="Status" tabs={tabs} value={status} onChange={setStatus} />}
        detail={`${shown.length} runs · ${usd(total)}`}
        actions={
          <Select
            compact
            label="Rule"
            className="w-36"
            value={ruleId}
            onChange={setRuleId}
            options={[
              { value: null, label: "All rules" },
              ...rules.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
        }
      />
      <PageBody className="@container">
        {runs.length === 0 ? (
          <Empty
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
            No runs yet. Turn a rule on or run it now.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty>No runs match these filters.</Empty>
        ) : (
          <table className={table.root}>
            <thead>
              <tr>
                <th className={table.th}>When</th>
                <th className={table.th}>Rule</th>
                <th className={table.th}>Status</th>
                <th className={table.th}>Detail</th>
                <th className={cn(table.th, "hidden @4xl:table-cell")}>Subject</th>
                <th className={cn(table.th, "hidden @4xl:table-cell")}>X id</th>
                <th className={cn(table.th, "text-right")}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={table.row}>
                  <td
                    className={cn(
                      table.td,
                      "font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums",
                    )}
                  >
                    {when(r.at)}
                  </td>
                  <td className={cn(table.td, "whitespace-nowrap")}>
                    {names.get(r.ruleId) ?? `#${r.ruleId}`}
                  </td>
                  <td
                    className={cn(
                      table.td,
                      "font-mono text-xs whitespace-nowrap",
                      statusTone[r.status],
                    )}
                  >
                    {statusLabel[r.status]}
                  </td>
                  <td className={cn(table.td, "w-full max-w-0")}>
                    <p
                      className={cn(
                        "truncate",
                        r.status === "failed" ? "text-error-foreground" : "text-foreground/90",
                      )}
                      title={r.detail}
                    >
                      {r.detail}
                    </p>
                  </td>
                  <td
                    className={cn(
                      table.td,
                      "hidden max-w-40 truncate font-mono text-xs text-muted-foreground @4xl:table-cell",
                    )}
                  >
                    {r.subjectId}
                  </td>
                  <td
                    className={cn(
                      table.td,
                      "hidden max-w-40 truncate font-mono text-xs text-muted-foreground @4xl:table-cell",
                    )}
                  >
                    {r.xId ?? ""}
                  </td>
                  <td
                    className={cn(table.td, table.num, r.costUsd === 0 && "text-muted-foreground")}
                  >
                    {usd(r.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </div>
  );
}

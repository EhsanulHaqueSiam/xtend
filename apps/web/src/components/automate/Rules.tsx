import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { Rule, RuleInput, RuleRun } from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Plus } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import {
  deleteRuleAtom,
  pendingAtom,
  rulesAtom,
  runRuleNowAtom,
  runsAtom,
  upsertRuleAtom,
} from "../../state/automate";
import { usd } from "../../state/costs";
import { ErrorBar, errorText } from "../analyze/ui";
import { useAction } from "../leads/ui";
import { PageHeader } from "../PageHeader";
import { sectionHref } from "../shell/sections";
import { Button } from "../ui/button";
import { Empty, table } from "../ui/layout";
import { RuleDetail } from "./RuleDetail";
import { RuleRow } from "./RuleRow";

/** Where a rule's runs live: the Runs section filtered to it. */
export const runsOf = (ruleId: number) => `${sectionHref("/automate", "runs")}&rule=${ruleId}`;

/**
 * Rules: the list fills the page; opening a rule (or New rule) adds its detail
 * column on the right, which takes the whole page when the split gets narrow.
 */
export function Rules() {
  const rules = useAtomValue(rulesAtom);
  const runs = useAtomValue(runsAtom);
  const refreshRules = useAtomRefresh(rulesAtom);
  const refreshRuns = useAtomRefresh(runsAtom);
  const refreshPending = useAtomRefresh(pendingAtom);
  const pendingCount = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(pendingAtom), (p) => p.length),
    () => 0,
  );
  const upsert = useAtomSet(upsertRuleAtom, { mode: "promise" });
  const remove = useAtomSet(deleteRuleAtom, { mode: "promise" });
  const runNow = useAtomSet(runRuleNowAtom, { mode: "promise" });
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  // null = no detail column, "new" = creating, a number = that rule open.
  const [open, setOpen] = useState<"new" | number | null>(null);
  // Bumped after a save so the editor restarts from what the service stored.
  const [saves, setSaves] = useState(0);
  const [doing, setDoing] = useState<"save" | "run" | null>(null);

  const list = AsyncResult.getOrElse(rules, () => [] as ReadonlyArray<Rule>);
  const runList = AsyncResult.getOrElse(runs, () => [] as ReadonlyArray<RuleRun>);
  const current =
    open === "new" || open === null ? null : (list.find((r) => r.id === open) ?? null);
  const showDetail = open === "new" || current !== null;
  const enabledCount = list.filter((r) => r.enabled).length;
  const spent = list.reduce((s, r) => s + r.spentUsdMonth, 0);

  const act = (work: () => Promise<unknown>, what: "save" | "run" | null = null) => {
    setDoing(what);
    return run(async () => {
      await work();
      refreshRules();
      refreshRuns();
      refreshPending();
    }).finally(() => setDoing(null));
  };
  const save = (input: RuleInput) =>
    void act(async () => {
      // A saved rule is switched from its row, so the editor never carries a stale Enabled.
      const saved = await upsert(current === null ? input : { ...input, enabled: current.enabled });
      setOpen(saved.id);
      setSaves((n) => n + 1);
    }, "save");
  const toggle = (rule: Rule) => void act(() => upsert({ ...rule, enabled: !rule.enabled }));

  return (
    <div className="@container flex h-full flex-col">
      <PageHeader
        title="Rules"
        detail={`${enabledCount} of ${list.length} on · ${usd(spent)} this month`}
        actions={
          <>
            {pendingCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-warning-foreground"
                onClick={() => void navigate({ href: sectionHref("/automate", "needs-you") })}
              >
                {pendingCount} need you
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => setOpen("new")}>
              <Plus />
              New rule
            </Button>
          </>
        }
      />
      <ErrorBar>{error}</ErrorBar>
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "@container/list min-w-0 flex-1 overflow-y-auto",
            showDetail && "hidden @2xl:block",
          )}
        >
          {AsyncResult.match(rules, {
            onInitial: () => <Empty>Connecting to the service.</Empty>,
            onFailure: (f) => (
              <Empty>
                <span className="text-error-foreground">{errorText(f.cause)}</span>
              </Empty>
            ),
            onSuccess: ({ value }) =>
              value.length === 0 ? (
                <Empty
                  action={
                    open === "new" ? undefined : (
                      <Button size="sm" variant="outline" onClick={() => setOpen("new")}>
                        <Plus />
                        New rule
                      </Button>
                    )
                  }
                >
                  No rules yet. A new rule starts as a dry run.
                </Empty>
              ) : (
                <table className={table.root}>
                  <thead>
                    <tr>
                      <th className={cn(table.th, "w-0 pr-1")}>
                        <span className="sr-only">On</span>
                      </th>
                      <th className={table.th}>Rule</th>
                      <th className={cn(table.th, "text-right")}>Per fire</th>
                      <th className={cn(table.th, "hidden text-right @2xl/list:table-cell")}>
                        Today
                      </th>
                      <th className={cn(table.th, "hidden text-right @2xl/list:table-cell")}>
                        This month
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.map((rule) => (
                      <RuleRow
                        key={rule.id}
                        rule={rule}
                        selected={rule.id === open}
                        busy={busy}
                        onSelect={() => setOpen(rule.id === open ? null : rule.id)}
                        onToggle={() => toggle(rule)}
                      />
                    ))}
                  </tbody>
                </table>
              ),
          })}
        </div>
        {showDetail ? (
          <RuleDetail
            rule={current}
            runs={current === null ? [] : runList.filter((r) => r.ruleId === current.id)}
            busy={busy}
            saving={doing === "save"}
            running={doing === "run"}
            formKey={`${open}:${saves}`}
            className="w-full @2xl:w-[380px] @2xl:shrink-0 @2xl:border-l @2xl:border-border"
            onClose={() => setOpen(null)}
            onSave={save}
            onToggle={() => current !== null && toggle(current)}
            onRunNow={() => {
              if (current === null) return;
              const id = current.id;
              void act(async () => {
                await runNow(id);
                await navigate({ href: runsOf(id) });
              }, "run");
            }}
            onShowRuns={() => current !== null && void navigate({ href: runsOf(current.id) })}
            onDelete={() => {
              if (current === null) return;
              const id = current.id;
              void act(async () => {
                await remove(id);
                setOpen(null);
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

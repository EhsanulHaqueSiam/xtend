import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Rule, RuleInput } from "@xtend/contracts";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { Empty, ErrorText, errorText, Tabs } from "../components/analyze/ui";
import { DryRun } from "../components/automate/DryRun";
import { NeedsYou } from "../components/automate/NeedsYou";
import { emptyRule, RuleForm } from "../components/automate/RuleForm";
import { RuleRow } from "../components/automate/RuleRow";
import { RunsLog } from "../components/automate/RunsLog";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import {
  deleteRuleAtom,
  pendingAtom,
  rulesAtom,
  runRuleNowAtom,
  runsAtom,
  upsertRuleAtom,
} from "../state/automate";

const TABS = ["Rules", "Needs you", "Dry run", "Runs"] as const;

function AutomateScreen() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Rules");
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
  // null = closed, "new" = creating, Rule = editing that rule.
  const [editing, setEditing] = useState<"new" | Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ruleList = AsyncResult.getOrElse(rules, () => [] as ReadonlyArray<Rule>);
  const enabledCount = ruleList.filter((r) => r.enabled).length;
  const spent = ruleList.reduce((s, r) => s + r.spentUsdMonth, 0);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      refreshRules();
      refreshRuns();
      refreshPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = (input: RuleInput) =>
    act(async () => {
      await upsert(input);
      setEditing(null);
    });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Automate"
        detail={`${enabledCount} of ${ruleList.length} rules on · $${spent.toFixed(3)} spent this month${pendingCount > 0 ? ` · ${pendingCount} need you` : ""}`}
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            New rule
          </Button>
        }
      />
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 overflow-y-auto px-4 py-3">
        {error !== null ? <ErrorText>{error}</ErrorText> : null}
        {editing !== null ? (
          <RuleForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? emptyRule : editing}
            saving={busy}
            onSave={(r) => void save(r)}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {tab === "Rules" ? (
          AsyncResult.match(rules, {
            onInitial: () => <Empty>Connecting to the service…</Empty>,
            onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
            onSuccess: ({ value }) =>
              value.length === 0 ? (
                <Empty>No rules yet. Create one; it starts as a dry run.</Empty>
              ) : (
                <div className="rounded-lg border border-border bg-card px-3 text-xs">
                  {value.map((rule) => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      busy={busy}
                      onToggle={() => void act(() => upsert({ ...rule, enabled: !rule.enabled }))}
                      onEdit={() => setEditing(rule)}
                      onRunNow={() =>
                        void act(async () => {
                          await runNow(rule.id);
                          setTab("Runs");
                        })
                      }
                      onDelete={() => void act(() => remove(rule.id))}
                    />
                  ))}
                </div>
              ),
          })
        ) : tab === "Needs you" ? (
          <NeedsYou />
        ) : tab === "Dry run" ? (
          <DryRun rules={ruleList} />
        ) : (
          AsyncResult.match(runs, {
            onInitial: () => <Empty>Loading runs…</Empty>,
            onFailure: (f) => <ErrorText>{errorText(f.cause)}</ErrorText>,
            onSuccess: ({ value }) => <RunsLog runs={value} rules={ruleList} />,
          })
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/automate")({ component: AutomateScreen });

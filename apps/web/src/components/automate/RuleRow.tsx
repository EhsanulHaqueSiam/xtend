import { actionCostUsd, type Rule } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { usd } from "../analyze/ui";
import { Button } from "../ui/button";
import { describeAction, describeTrigger } from "./describe";

export function RuleRow({
  rule,
  busy,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
}: {
  readonly rule: Rule;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onRunNow: () => void;
  readonly onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState<"run" | "delete" | null>(null);
  const cost = actionCostUsd(rule.action);
  const askFirst = !rule.dryRun;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <Button
          variant={rule.enabled ? "secondary" : "ghost-muted"}
          size="micro"
          disabled={busy}
          onClick={onToggle}
        >
          {rule.enabled ? "on" : "off"}
        </Button>
        <span className={cn("font-medium", !rule.enabled && "text-muted-foreground")}>
          {rule.name}
        </span>
        {rule.dryRun ? <span className="text-2xs text-warning-foreground">dry run</span> : null}
        {rule.action.kind === "auto_delete" ? (
          <span className="text-2xs text-muted-foreground">ask first</span>
        ) : null}
        <span className="flex-1" />
        <span className="font-mono text-2xs text-muted-foreground">
          {usd(cost)} / fire · {usd(rule.spentUsdMonth)} of {usd(rule.budgetUsdMonth)} this month
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => (askFirst ? setConfirm(confirm === "run" ? null : "run") : onRunNow())}
        >
          Run now
        </Button>
        <Button variant="ghost" size="xs" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost-destructive"
          size="xs"
          disabled={busy}
          onClick={() => setConfirm(confirm === "delete" ? null : "delete")}
        >
          Delete
        </Button>
      </div>
      <p className="text-2xs text-muted-foreground">
        {describeTrigger(rule.trigger)} · {describeAction(rule.action)}
      </p>
      {confirm === "run" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-xs">
          <span>
            Fire "{rule.name}" now at {usd(cost)} per{" "}
            {rule.action.kind === "auto_delete" ? "post" : "fire"}, capped by its{" "}
            {usd(rule.budgetUsdMonth)} monthly budget. This charges your treg balance.
          </span>
          <Button
            size="xs"
            onClick={() => {
              setConfirm(null);
              onRunNow();
            }}
          >
            Confirm and run
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      ) : confirm === "delete" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
          <span>Delete rule "{rule.name}"? Its runs log stays.</span>
          <Button
            variant="destructive"
            size="xs"
            onClick={() => {
              setConfirm(null);
              onDelete();
            }}
          >
            Delete
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

import { useAtomSet } from "@effect/atom-react";
import { actionCostUsd, type Rule, type WebhookInfo } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { webhookInfoAtom } from "../../state/automate";
import { useRates } from "../../state/costs";
import { usd } from "../analyze/ui";
import { Button } from "../ui/button";
import { describeAction, describeConditions, describeTrigger, triggerPoll } from "./describe";

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
  const [webhook, setWebhook] = useState<WebhookInfo | string | null>(null);
  const loadWebhook = useAtomSet(webhookInfoAtom, { mode: "promise" });
  const rates = useRates();
  const cost = rates === null ? 0 : actionCostUsd(rates, rule.action);
  const poll = rates === null || rule.dryRun ? null : triggerPoll(rates, rule.trigger);
  // An ask-first rule only queues, but a polled trigger still pays X for the poll first.
  const confirmRun = !rule.dryRun && (!rule.askFirst || poll !== null);
  const conditions = describeConditions(rule.conditions);
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
        {rule.askFirst ? <span className="text-2xs text-muted-foreground">ask first</span> : null}
        <span className="flex-1" />
        <span className="font-mono text-2xs text-muted-foreground">
          {usd(cost)} / fire{poll === null ? "" : ` · ${usd(poll.usd)} / poll`} ·{" "}
          {usd(rule.spentUsdDay)} of {usd(rule.budgetUsdDay)} today · {usd(rule.spentUsdMonth)} of{" "}
          {usd(rule.budgetUsdMonth)} this month
        </span>
        {rule.trigger.kind === "webhook" ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              webhook === null
                ? void loadWebhook(rule.id).then(setWebhook, (e: unknown) =>
                    setWebhook(e instanceof Error ? e.message : String(e)),
                  )
                : setWebhook(null)
            }
          >
            Webhook
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => (confirmRun ? setConfirm(confirm === "run" ? null : "run") : onRunNow())}
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
        {describeTrigger(rule.trigger)}
        {conditions === "" ? "" : ` · only if ${conditions}`}
        {rule.waitMinutes > 0 ? ` · wait ${rule.waitMinutes} min` : ""} ·{" "}
        {describeAction(rule.action)}
        {rule.undoAfterHours !== null ? ` · undo after ${rule.undoAfterHours}h` : ""}
      </p>
      {typeof webhook === "string" ? (
        <p className="text-2xs text-error-foreground">{webhook}</p>
      ) : webhook !== null ? (
        <p className="font-mono text-2xs text-muted-foreground">
          POST {webhook.path} · header X-Xtend-Signature: sha256=HMAC-SHA256(body) with secret{" "}
          <span className="text-foreground select-all">{webhook.secret}</span>
        </p>
      ) : null}
      {confirm === "run" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-surface px-3 py-2 text-xs">
          <span>
            {rule.askFirst
              ? `Run "${rule.name}" now: its poll costs up to ${usd(poll?.usd ?? 0)} and what it finds waits in Needs you.`
              : `Fire "${rule.name}" now at ${usd(cost)} per ${rule.action.kind === "auto_delete" ? "post" : "fire"}${poll === null ? "" : `, plus up to ${usd(poll.usd)} for the poll`}, capped by its ${usd(rule.budgetUsdDay)} daily budget.`}{" "}
            This charges your treg balance.
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
          <span>Delete rule "{rule.name}"? Its runs log goes with it.</span>
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

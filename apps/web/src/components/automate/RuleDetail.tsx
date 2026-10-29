import { useAtomSet } from "@effect/atom-react";
import {
  actionCostUsd,
  type Rule,
  type RuleInput,
  type RuleRun,
  type WebhookInfo,
} from "@xtend/contracts";
import { X } from "lucide-react";
import { useState } from "react";
import { TextMorph } from "torph/react";

import { webhookInfoAtom } from "../../state/automate";
import { usd, useRates } from "../../state/costs";
import { when } from "../analyze/ui";
import { Button } from "../ui/button";
import { Cost } from "../ui/layout";
import { Switch } from "../ui/switch";
import { Prop, PropGroup } from "./controls";
import { rulePoll, statusLabel, statusTone } from "./describe";
import { emptyRule, RuleForm } from "./RuleForm";
import { budget, RuleModes } from "./RuleRow";

/** A saved rule's state, numbers and actions, above its editor. */
function RuleState({
  rule,
  runs,
  busy,
  running,
  onToggle,
  onRunNow,
  onShowRuns,
  onDelete,
}: {
  readonly rule: Rule;
  readonly runs: ReadonlyArray<RuleRun>;
  readonly busy: boolean;
  readonly running: boolean;
  readonly onToggle: () => void;
  readonly onRunNow: () => void;
  readonly onShowRuns: () => void;
  readonly onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState<"run" | "delete" | null>(null);
  // The secret, or why it could not be loaded.
  const [webhook, setWebhook] = useState<WebhookInfo | string | null>(null);
  const loadWebhook = useAtomSet(webhookInfoAtom, { mode: "promise" });
  const rates = useRates();
  const cost = rates === null ? null : actionCostUsd(rates, rule.action);
  const per = rule.action.kind === "auto_delete" ? "post" : "fire";
  // Dry runs never poll.
  const poll = rates === null || rule.dryRun ? null : rulePoll(rates, rule);
  // Dry runs charge nothing. An ask-first rule only queues, but a polled trigger still pays X
  // for the poll first, so it asks to confirm too.
  const paid = !rule.dryRun && (!rule.askFirst || poll !== null);
  // Without the rate card neither the price nor whether a poll pays is known.
  const unpriced = !rule.dryRun && rates === null;
  const last = runs[0];
  return (
    <div className="px-5">
      <div className="mt-2 flex items-center gap-2 text-xs">
        <Switch checked={rule.enabled} disabled={busy} label="On" onChange={onToggle} />
        <span className={rule.enabled ? "text-foreground" : "text-muted-foreground"}>
          {rule.enabled ? "On" : "Off"}
        </span>
        <RuleModes rule={rule} />
      </div>

      <PropGroup title="Numbers">
        <Prop as="div" label={`Per ${per}`}>
          {cost === null ? "…" : usd(cost)}
        </Prop>
        {poll !== null ? (
          <Prop as="div" label="Per poll">
            {usd(poll.usd)}
            <span className="text-muted-foreground">every {poll.every}</span>
          </Prop>
        ) : null}
        <Prop as="div" label="Today">
          {usd(rule.spentUsdDay)}
          <span className="text-muted-foreground">of {budget(rule.budgetUsdDay)}</span>
        </Prop>
        <Prop as="div" label="This month">
          {usd(rule.spentUsdMonth)}
          <span className="text-muted-foreground">of {budget(rule.budgetUsdMonth)}</span>
        </Prop>
        <Prop as="div" label="Runs">
          {last === undefined ? (
            <span className="text-muted-foreground">none yet</span>
          ) : (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 hover:underline"
              onClick={onShowRuns}
            >
              {runs.length}
              <span className="text-muted-foreground">last</span>
              <span className={statusTone[last.status]}>{statusLabel[last.status]}</span>
              <span className="text-muted-foreground">{when(last.at)}</span>
            </button>
          )}
        </Prop>
      </PropGroup>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || unpriced}
          aria-expanded={paid ? confirm === "run" : undefined}
          onClick={() => (paid ? setConfirm(confirm === "run" ? null : "run") : onRunNow())}
        >
          <TextMorph duration={250}>{running ? "Running" : "Run now"}</TextMorph>
          {rule.dryRun ? (
            <Cost label="dry run" />
          ) : rule.askFirst ? (
            <Cost label="asks first" />
          ) : cost === null ? (
            <Cost label="…" />
          ) : (
            <Cost usd={cost} />
          )}
        </Button>
        {rule.trigger.kind === "webhook" ? (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={webhook !== null}
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
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost-destructive"
          disabled={busy}
          aria-expanded={confirm === "delete"}
          onClick={() => setConfirm(confirm === "delete" ? null : "delete")}
        >
          Delete
        </Button>
      </div>

      {confirm === "run" ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-xs">
          <p className="text-warning-foreground">
            {rule.askFirst
              ? `Charges your treg balance: its poll costs up to ${usd(poll?.usd ?? 0)} and what it finds waits in Needs you.`
              : `Charges your treg balance ${cost === null ? "…" : usd(cost)} per ${per}${poll === null ? "" : `, plus up to ${usd(poll.usd)} for the poll`}, capped by the ${budget(rule.budgetUsdDay)} daily budget.`}
          </p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="warning-outline"
              disabled={unpriced}
              onClick={() => {
                setConfirm(null);
                onRunNow();
              }}
            >
              Confirm and run
              {rule.askFirst ? (
                <Cost usd={poll?.usd ?? 0} />
              ) : cost === null ? (
                <Cost label="…" />
              ) : (
                <Cost usd={cost} />
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : confirm === "delete" ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-xs">
          <p>Delete this rule? Its runs log goes with it.</p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setConfirm(null);
                onDelete();
              }}
            >
              Delete rule
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {typeof webhook === "string" ? (
        <p className="mt-3 text-xs text-error-foreground">{webhook}</p>
      ) : webhook !== null ? (
        <PropGroup title="Webhook">
          <Prop as="div" label="POST">
            <span className="truncate select-all">{webhook.path}</span>
          </Prop>
          <Prop as="div" label="Header">
            <span className="truncate">X-Xtend-Signature: sha256=HMAC-SHA256(body)</span>
          </Prop>
          <Prop as="div" label="Secret">
            <span className="truncate select-all">{webhook.secret}</span>
          </Prop>
        </PropGroup>
      ) : null}
    </div>
  );
}

/**
 * The detail column of Rules (`DetailSplit`, closable): the open rule's state
 * and actions over its editor, or the editor alone for a new rule.
 */
export function RuleDetail({
  rule,
  runs,
  busy,
  saving,
  running,
  formKey,
  saved,
  onClose,
  onSave,
  onToggle,
  onRunNow,
  onShowRuns,
  onDelete,
}: {
  /** null while creating a rule. */
  readonly rule: Rule | null;
  /** This rule's runs, newest first. */
  readonly runs: ReadonlyArray<RuleRun>;
  readonly busy: boolean;
  readonly saving: boolean;
  readonly running: boolean;
  /** Changes after a save, so the editor restarts from what the service stored. */
  readonly formKey: string;
  /** What the last save of this rule stored, ahead of the refetched list. */
  readonly saved?: Rule | null;
  readonly onClose: () => void;
  readonly onSave: (input: RuleInput) => void;
  readonly onToggle: () => void;
  readonly onRunNow: () => void;
  readonly onShowRuns: () => void;
  readonly onDelete: () => void;
}) {
  return (
    // At least the column's height, so the editor's actions sit at its foot.
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2 pt-4 pr-3 pl-5">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
          {rule === null ? "New rule" : rule.name}
        </h2>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {rule === null ? null : (
        <RuleState
          rule={rule}
          runs={runs}
          busy={busy}
          running={running}
          onToggle={onToggle}
          onRunNow={onRunNow}
          onShowRuns={onShowRuns}
          onDelete={onDelete}
        />
      )}
      <RuleForm
        key={formKey}
        initial={saved ?? rule ?? emptyRule}
        saving={saving}
        onSave={onSave}
        onCancel={onClose}
      />
    </div>
  );
}

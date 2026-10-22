import { actionCostUsd, type Action, type RuleInput, type Trigger } from "@xtend/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { inputClass, usd } from "../analyze/ui";
import { Button } from "../ui/button";

const TRIGGERS: Record<Trigger["kind"], { label: string; init: Trigger }> = {
  post_crosses_threshold: {
    label: "My post crosses a threshold",
    init: { kind: "post_crosses_threshold", metric: "views", threshold: 5000 },
  },
  schedule: { label: "Schedule", init: { kind: "schedule", weekdays: [1, 4], time: "18:00" } },
  new_engager: { label: "New engager", init: { kind: "new_engager" } },
  keyword_post: { label: "Keyword post", init: { kind: "keyword_post", query: "" } },
};

const ACTIONS: Record<Action["kind"], { label: string; init: Action }> = {
  auto_plug: { label: "Auto plug (reply)", init: { kind: "auto_plug", text: "" } },
  auto_dm: { label: "Auto DM", init: { kind: "auto_dm", template: "Thanks {name}!" } },
  auto_retweet: { label: "Evergreen repost", init: { kind: "auto_retweet", evergreen: true } },
  auto_like: { label: "Auto like", init: { kind: "auto_like" } },
  auto_delete: {
    label: "Auto delete",
    init: { kind: "auto_delete", olderThanDays: 2, maxViews: 300 },
  },
  clean_profile: { label: "Clean profile", init: { kind: "clean_profile", afterHours: 24 } },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const emptyRule: RuleInput = {
  name: "",
  enabled: false,
  trigger: TRIGGERS.post_crosses_threshold.init,
  action: ACTIONS.auto_plug.init,
  budgetUsdMonth: 1,
  dryRun: true,
};

const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function RuleForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  readonly initial: RuleInput;
  readonly saving: boolean;
  readonly onSave: (rule: RuleInput) => void;
  readonly onCancel: () => void;
}) {
  const [rule, setRule] = useState(initial);
  const { trigger, action } = rule;
  const setTrigger = (t: Trigger) => setRule({ ...rule, trigger: t });
  // Delete actions default to ask-first: switching to auto_delete turns dry run on.
  const setAction = (a: Action) =>
    setRule({ ...rule, action: a, dryRun: a.kind === "auto_delete" ? true : rule.dryRun });
  const cost = actionCostUsd(action);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-xs">
      <Row label="Name">
        <input
          className={cn(inputClass, "w-64")}
          value={rule.name}
          placeholder="Auto plug"
          onChange={(e) => setRule({ ...rule, name: e.target.value })}
        />
      </Row>
      <Row label="When">
        <select
          className={cn(inputClass, "w-auto")}
          value={trigger.kind}
          onChange={(e) => setTrigger(TRIGGERS[e.target.value as Trigger["kind"]].init)}
        >
          {Object.entries(TRIGGERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </Row>
      {trigger.kind === "post_crosses_threshold" ? (
        <Row label="Reaches">
          <span className="flex gap-1">
            <input
              type="number"
              min={0}
              className={cn(inputClass, "w-24")}
              value={trigger.threshold}
              onChange={(e) => setTrigger({ ...trigger, threshold: int(e.target.value) })}
            />
            <select
              className={cn(inputClass, "w-auto")}
              value={trigger.metric}
              onChange={(e) =>
                setTrigger({ ...trigger, metric: e.target.value as typeof trigger.metric })
              }
            >
              <option value="views">views</option>
              <option value="likes">likes</option>
            </select>
          </span>
        </Row>
      ) : trigger.kind === "schedule" ? (
        <Row label="Days and time">
          <span className="flex items-center gap-1">
            {DAYS.map((d, i) => (
              <Button
                key={d}
                variant={trigger.weekdays.includes(i) ? "secondary" : "ghost-muted"}
                size="micro"
                onClick={() =>
                  setTrigger({
                    ...trigger,
                    weekdays: trigger.weekdays.includes(i)
                      ? trigger.weekdays.filter((x) => x !== i)
                      : [...trigger.weekdays, i].sort(),
                  })
                }
              >
                {d}
              </Button>
            ))}
            <input
              type="time"
              className={cn(inputClass, "w-auto")}
              value={trigger.time}
              onChange={(e) => setTrigger({ ...trigger, time: e.target.value })}
            />
          </span>
        </Row>
      ) : trigger.kind === "keyword_post" ? (
        <Row label="Query">
          <input
            className={cn(inputClass, "w-64")}
            value={trigger.query}
            placeholder="x growth"
            onChange={(e) => setTrigger({ ...trigger, query: e.target.value })}
          />
        </Row>
      ) : null}
      <Row label="Then">
        <select
          className={cn(inputClass, "w-auto")}
          value={action.kind}
          onChange={(e) => setAction(ACTIONS[e.target.value as Action["kind"]].init)}
        >
          {Object.entries(ACTIONS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </Row>
      {action.kind === "auto_plug" ? (
        <Row label="Reply text">
          <input
            className={cn(inputClass, "w-64")}
            value={action.text}
            placeholder="Full breakdown here → https://…"
            onChange={(e) => setAction({ ...action, text: e.target.value })}
          />
        </Row>
      ) : action.kind === "auto_dm" ? (
        <Row label="Template ({name})">
          <input
            className={cn(inputClass, "w-64")}
            value={action.template}
            onChange={(e) => setAction({ ...action, template: e.target.value })}
          />
        </Row>
      ) : action.kind === "auto_retweet" ? (
        <Row label="Pick from my top posts">
          <input
            type="checkbox"
            checked={action.evergreen}
            onChange={(e) => setAction({ ...action, evergreen: e.target.checked })}
          />
        </Row>
      ) : action.kind === "auto_delete" ? (
        <Row label="Older than days / under views">
          <span className="flex gap-1">
            <input
              type="number"
              min={0}
              className={cn(inputClass, "w-20")}
              value={action.olderThanDays}
              onChange={(e) => setAction({ ...action, olderThanDays: int(e.target.value) })}
            />
            <input
              type="number"
              min={0}
              className={cn(inputClass, "w-24")}
              value={action.maxViews}
              onChange={(e) => setAction({ ...action, maxViews: int(e.target.value) })}
            />
          </span>
        </Row>
      ) : action.kind === "clean_profile" ? (
        <Row label="After hours">
          <input
            type="number"
            min={0}
            className={cn(inputClass, "w-20")}
            value={action.afterHours}
            onChange={(e) => setAction({ ...action, afterHours: int(e.target.value) })}
          />
        </Row>
      ) : null}
      <Row label="Budget per month (USD)">
        <input
          type="number"
          min={0}
          step={0.1}
          className={cn(inputClass, "w-24")}
          value={rule.budgetUsdMonth}
          onChange={(e) =>
            setRule({ ...rule, budgetUsdMonth: Math.max(0, Number(e.target.value) || 0) })
          }
        />
      </Row>
      <Row label="Dry run (log what would fire, charge nothing)">
        <input
          type="checkbox"
          checked={rule.dryRun}
          onChange={(e) => setRule({ ...rule, dryRun: e.target.checked })}
        />
      </Row>
      <Row label="Enabled">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
        />
      </Row>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="font-mono text-muted-foreground">
          {usd(cost)} per fire{action.kind === "auto_delete" ? " per post" : ""}
          {rule.dryRun ? " · dry run, nothing charged" : ""}
        </span>
        <span className="flex gap-1">
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={saving || rule.name.trim() === ""}
            onClick={() => onSave({ ...rule, name: rule.name.trim() })}
          >
            {saving ? "Saving…" : "Save rule"}
          </Button>
        </span>
      </div>
    </div>
  );
}

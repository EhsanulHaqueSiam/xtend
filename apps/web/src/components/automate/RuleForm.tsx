import { useAtomValue } from "@effect/atom-react";
import {
  actionCostUsd,
  type Action,
  type Conditions,
  type RuleInput,
  type Trigger,
} from "@xtend/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { cn, parsePostId } from "../../lib/utils";
import { useRates } from "../../state/costs";
import { listsAtom } from "../../state/leads";
import { inputClass, usd } from "../analyze/ui";
import { Button } from "../ui/button";
import { triggerPoll } from "./describe";

const TRIGGERS: Record<Trigger["kind"], { label: string; init: Trigger }> = {
  post_crosses_threshold: {
    label: "My post crosses a threshold",
    init: { kind: "post_crosses_threshold", metric: "views", threshold: 5000 },
  },
  schedule: { label: "Schedule", init: { kind: "schedule", weekdays: [1, 4], time: "18:00" } },
  new_engager: { label: "New engager", init: { kind: "new_engager" } },
  keyword_post: { label: "Keyword post", init: { kind: "keyword_post", query: "" } },
  post_engaged: {
    label: "Someone reposts or likes a post",
    init: { kind: "post_engaged", postId: "", via: "repost" },
  },
  new_follower: { label: "New follower", init: { kind: "new_follower" } },
  agent_match: { label: "Agent finds a lead", init: { kind: "agent_match", minScore: 70 } },
  webhook: { label: "Webhook call", init: { kind: "webhook" } },
};

const ACTIONS: Record<Action["kind"], { label: string; init: Action }> = {
  auto_plug: { label: "Auto plug (reply)", init: { kind: "auto_plug", text: "" } },
  auto_dm: { label: "Auto DM", init: { kind: "auto_dm", template: "Thanks {name}!" } },
  auto_retweet: { label: "Evergreen repost", init: { kind: "auto_retweet", evergreen: true } },
  auto_like: { label: "Auto like", init: { kind: "auto_like" } },
  follow: { label: "Follow them", init: { kind: "follow" } },
  add_to_list: { label: "Add to list", init: { kind: "add_to_list", listId: 0 } },
  notify: { label: "Notify me", init: { kind: "notify", message: "{name} engaged" } },
  unrepost: { label: "Undo repost", init: { kind: "unrepost" } },
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
  conditions: {},
  waitMinutes: 0,
  action: ACTIONS.auto_plug.init,
  budgetUsdDay: 0.5,
  budgetUsdMonth: 1,
  undoAfterHours: null,
  askFirst: false,
  dryRun: true,
};

const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
const money = (v: string) => Math.max(0, Number(v) || 0);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  width = "w-20",
  step,
}: {
  readonly value: number;
  readonly onChange: (n: number) => void;
  readonly width?: string;
  readonly step?: number;
}) {
  const parse = step === undefined ? int : money;
  // The typed text, so clearing the field to retype does not snap a 0 back in front of it.
  const [text, setText] = useState(String(value));
  return (
    <input
      type="number"
      min={0}
      step={step}
      className={cn(inputClass, width)}
      value={text === "" || parse(text) === value ? text : value}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
    />
  );
}

/** Optional number condition: blank means unset. */
function OptionalNumber({
  value,
  onChange,
  placeholder,
}: {
  readonly value: number | undefined;
  readonly onChange: (n: number | undefined) => void;
  readonly placeholder: string;
}) {
  return (
    <input
      inputMode="numeric"
      className={cn(inputClass, "w-20")}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : int(e.target.value))}
    />
  );
}

function ListSelect({
  value,
  onChange,
  none,
}: {
  readonly value: number | undefined;
  readonly onChange: (id: number | undefined) => void;
  readonly none: string;
}) {
  const lists = AsyncResult.getOrElse(useAtomValue(listsAtom), () => []);
  return (
    <select
      className={cn(inputClass, "w-auto")}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    >
      <option value="">{none}</option>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
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
  const { trigger, action, conditions } = rule;
  const setTrigger = (t: Trigger) => setRule({ ...rule, trigger: t });
  const setConditions = (c: Conditions) => setRule({ ...rule, conditions: c });
  // Delete actions default to ask-first.
  const setAction = (a: Action) =>
    setRule({ ...rule, action: a, askFirst: a.kind === "auto_delete" ? true : rule.askFirst });
  const rates = useRates();
  const cost = rates === null ? null : actionCostUsd(rates, action);
  const poll = rates === null ? null : triggerPoll(rates, trigger);
  const valid =
    rule.name.trim() !== "" &&
    (trigger.kind !== "post_engaged" || parsePostId(trigger.postId) !== null) &&
    (trigger.kind !== "schedule" ||
      (trigger.weekdays.length > 0 && /^\d{2}:\d{2}$/.test(trigger.time))) &&
    (trigger.kind !== "keyword_post" || trigger.query.trim() !== "") &&
    (action.kind !== "add_to_list" || action.listId > 0);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-xs">
      <Row label="Name">
        <input
          className={cn(inputClass, "w-64")}
          value={rule.name}
          placeholder="Thank reposters"
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
            <NumberInput
              width="w-24"
              value={trigger.threshold}
              onChange={(threshold) => setTrigger({ ...trigger, threshold })}
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
      ) : trigger.kind === "post_engaged" ? (
        <Row label="Post id and kind">
          <span className="flex gap-1">
            <input
              className={cn(inputClass, "w-48")}
              value={trigger.postId}
              placeholder="1835124037934367098"
              aria-label="Post id"
              onChange={(e) =>
                setTrigger({
                  ...trigger,
                  postId: parsePostId(e.target.value) ?? e.target.value.trim(),
                })
              }
            />
            <select
              className={cn(inputClass, "w-auto")}
              value={trigger.via}
              onChange={(e) =>
                setTrigger({ ...trigger, via: e.target.value as typeof trigger.via })
              }
            >
              <option value="repost">reposts (scraper)</option>
              <option value="like">likes (X API, first 20)</option>
            </select>
          </span>
        </Row>
      ) : trigger.kind === "agent_match" ? (
        <Row label="Minimum score">
          <NumberInput
            value={trigger.minScore}
            onChange={(n) => setTrigger({ ...trigger, minScore: Math.min(100, n) })}
          />
        </Row>
      ) : trigger.kind === "webhook" ? (
        <p className="text-2xs text-muted-foreground">
          Save the rule, then open its Webhook URL from the rule row.
        </p>
      ) : null}
      {poll !== null ? (
        <p className="text-2xs text-muted-foreground">
          Polls X every {poll.every}: {usd(poll.usd)} a poll, up to {usd(poll.usd * poll.perDay)} a
          day{rule.dryRun ? ", not while a dry run" : ""}.
        </p>
      ) : null}

      <Row label="Only if">
        <span className="flex flex-wrap items-center justify-end gap-1">
          <OptionalNumber
            placeholder="within h"
            value={conditions.withinHours}
            onChange={(withinHours) => setConditions({ ...conditions, withinHours })}
          />
          <select
            className={cn(inputClass, "w-auto")}
            value={conditions.link ?? ""}
            onChange={(e) =>
              setConditions({
                ...conditions,
                link: e.target.value === "" ? undefined : (e.target.value as "has" | "none"),
              })
            }
          >
            <option value="">link or not</option>
            <option value="has">has a link</option>
            <option value="none">no link</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={conditions.notReply === true}
              onChange={(e) =>
                setConditions({ ...conditions, notReply: e.target.checked ? true : undefined })
              }
            />
            not a reply
          </label>
          <OptionalNumber
            placeholder="author ≥ followers"
            value={conditions.minAuthorFollowers}
            onChange={(minAuthorFollowers) => setConditions({ ...conditions, minAuthorFollowers })}
          />
          <ListSelect
            none="not in list: any"
            value={conditions.notInListId}
            onChange={(notInListId) => setConditions({ ...conditions, notInListId })}
          />
        </span>
      </Row>
      <Row label="Wait before acting (minutes)">
        <NumberInput
          value={rule.waitMinutes}
          onChange={(waitMinutes) => setRule({ ...rule, waitMinutes })}
        />
      </Row>

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
      ) : action.kind === "notify" ? (
        <Row label="Message ({name})">
          <input
            className={cn(inputClass, "w-64")}
            value={action.message}
            onChange={(e) => setAction({ ...action, message: e.target.value })}
          />
        </Row>
      ) : action.kind === "add_to_list" ? (
        <Row label="List">
          <ListSelect
            none="pick a list"
            value={action.listId > 0 ? action.listId : undefined}
            onChange={(listId) => setAction({ ...action, listId: listId ?? 0 })}
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
            <NumberInput
              value={action.olderThanDays}
              onChange={(olderThanDays) => setAction({ ...action, olderThanDays })}
            />
            <NumberInput
              width="w-24"
              value={action.maxViews}
              onChange={(maxViews) => setAction({ ...action, maxViews })}
            />
          </span>
        </Row>
      ) : action.kind === "clean_profile" ? (
        <Row label="After hours">
          <NumberInput
            value={action.afterHours}
            onChange={(afterHours) => setAction({ ...action, afterHours })}
          />
        </Row>
      ) : null}
      <Row label="Undo after hours (blank: never)">
        <OptionalNumber
          placeholder="never"
          value={rule.undoAfterHours ?? undefined}
          onChange={(h) => setRule({ ...rule, undoAfterHours: h ?? null })}
        />
      </Row>
      <Row label="Budget per day / per month (USD)">
        <span className="flex gap-1">
          <NumberInput
            step={0.1}
            width="w-24"
            value={rule.budgetUsdDay}
            onChange={(budgetUsdDay) => setRule({ ...rule, budgetUsdDay })}
          />
          <NumberInput
            step={0.1}
            width="w-24"
            value={rule.budgetUsdMonth}
            onChange={(budgetUsdMonth) => setRule({ ...rule, budgetUsdMonth })}
          />
        </span>
      </Row>
      <Row label="Ask first (queue in Needs you, act on Approve)">
        <input
          type="checkbox"
          checked={rule.askFirst}
          onChange={(e) => setRule({ ...rule, askFirst: e.target.checked })}
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
          {cost === null ? "…" : usd(cost)} per fire
          {action.kind === "auto_delete" ? " per post" : ""}
          {rule.undoAfterHours !== null ? ` + ${usd(rates?.delete ?? 0)} undo` : ""}
          {rule.dryRun ? " · dry run, nothing charged" : ""}
        </span>
        <span className="flex gap-1">
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={saving || !valid}
            onClick={() => onSave({ ...rule, name: rule.name.trim() })}
          >
            {saving ? "Saving…" : "Save rule"}
          </Button>
        </span>
      </div>
    </div>
  );
}

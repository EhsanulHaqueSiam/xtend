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

import { TextMorph } from "torph/react";

import { cn, parsePostId } from "../../lib/utils";
import { usd, useRates } from "../../state/costs";
import { listsAtom } from "../../state/leads";
import { Button } from "../ui/button";
import { compactInputClass } from "../ui/field";
import { Cost } from "../ui/layout";
import { Switch } from "../ui/switch";
import { Select } from "../ui/select";
import { Prop, PropGroup } from "./controls";
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

// A choice reads as text like the values beside it until hovered; translate, not a negative
// margin, lines it up, since a margin would squeeze the value out of its own width.
const prop = "translate-x-2 border-transparent font-sans";

/** A label table as Select options, keyed by the union it covers. */
const entries = <K extends string>(table: Record<K, { readonly label: string }>) =>
  (Object.keys(table) as Array<K>).map((value) => ({ value, label: table[value].label }));

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

// Values read as text until hovered or focused, as in an inspector's properties list.
const field = (width: string) =>
  cn(
    compactInputClass,
    "border-transparent bg-transparent text-right font-mono [text-align-last:right]",
    width,
  );
// Inputs carry their padding past the column so their text lines up with read-only values.
const inputField = (width: string) => cn(field(width), "-mr-2");
const noSpinner =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

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
      className={cn(inputField(width), noSpinner)}
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
      className={inputField("w-20")}
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
    <Select
      compact
      className={prop}
      value={value}
      onChange={onChange}
      options={[
        { value: undefined, label: none },
        ...lists.map((l) => ({ value: l.id, label: l.name })),
      ]}
    />
  );
}

/**
 * The rule editor, a properties list for the detail column: when, only if,
 * then, limits, with what one firing costs beside Save. A new rule also sets
 * Enabled here; a saved one is switched on and off from its row.
 */
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
  const [dirty, setDirty] = useState(false);
  const edit = (next: RuleInput) => {
    setRule(next);
    setDirty(true);
  };
  const { trigger, action, conditions } = rule;
  const setTrigger = (t: Trigger) => edit({ ...rule, trigger: t });
  const setConditions = (c: Conditions) => edit({ ...rule, conditions: c });
  // Delete actions default to ask-first.
  const setAction = (a: Action) =>
    edit({ ...rule, action: a, askFirst: a.kind === "auto_delete" ? true : rule.askFirst });
  const rates = useRates();
  const cost = rates === null ? null : actionCostUsd(rates, action);
  const poll = rates === null ? null : triggerPoll(rates, trigger);
  const isNew = initial.id === undefined;
  const valid =
    rule.name.trim() !== "" &&
    (trigger.kind !== "post_engaged" || parsePostId(trigger.postId) !== null) &&
    (trigger.kind !== "schedule" ||
      (trigger.weekdays.length > 0 && /^\d{2}:\d{2}$/.test(trigger.time))) &&
    (trigger.kind !== "keyword_post" || trigger.query.trim() !== "") &&
    (action.kind !== "add_to_list" || action.listId > 0);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !saving) onSave({ ...rule, name: rule.name.trim() });
      }}
    >
      <div className="flex-1 px-5 pb-6">
        <PropGroup title="Rule">
          <Prop label="Name">
            <input
              // A new rule's first step is its name; a saved one opens on its numbers.
              autoFocus={isNew}
              className={inputField("w-48")}
              value={rule.name}
              placeholder="Thank reposters"
              onChange={(e) => edit({ ...rule, name: e.target.value })}
            />
          </Prop>
        </PropGroup>

        <PropGroup title="When">
          <Prop label="Trigger">
            <Select
              compact
              label="Trigger"
              className={prop}
              value={trigger.kind}
              onChange={(kind) => setTrigger(TRIGGERS[kind].init)}
              options={entries(TRIGGERS)}
            />
          </Prop>
          {trigger.kind === "post_crosses_threshold" ? (
            <Prop label="Reaches">
              <NumberInput
                width="w-24"
                value={trigger.threshold}
                onChange={(threshold) => setTrigger({ ...trigger, threshold })}
              />
              <Select
                compact
                label="Metric"
                className={prop}
                value={trigger.metric}
                onChange={(metric) => setTrigger({ ...trigger, metric })}
                options={[
                  { value: "views", label: "views" },
                  { value: "likes", label: "likes" },
                ]}
              />
            </Prop>
          ) : trigger.kind === "schedule" ? (
            <>
              <Prop label="Days" as="div">
                {DAYS.map((d, i) => (
                  <Button
                    key={d}
                    variant={trigger.weekdays.includes(i) ? "secondary" : "ghost-muted"}
                    size="micro"
                    aria-pressed={trigger.weekdays.includes(i)}
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
              </Prop>
              <Prop label="Time">
                <input
                  type="time"
                  className={inputField("w-auto")}
                  value={trigger.time}
                  onChange={(e) => setTrigger({ ...trigger, time: e.target.value })}
                />
              </Prop>
            </>
          ) : trigger.kind === "keyword_post" ? (
            <Prop label="Query">
              <input
                className={inputField("w-48")}
                value={trigger.query}
                placeholder="x growth"
                onChange={(e) => setTrigger({ ...trigger, query: e.target.value })}
              />
            </Prop>
          ) : trigger.kind === "post_engaged" ? (
            <>
              <Prop label="Post id">
                <input
                  className={inputField("w-48")}
                  value={trigger.postId}
                  placeholder="1835124037934367098"
                  // A pasted post URL keeps only its id.
                  onChange={(e) =>
                    setTrigger({
                      ...trigger,
                      postId: parsePostId(e.target.value) ?? e.target.value.trim(),
                    })
                  }
                />
              </Prop>
              <Prop label="Via">
                <Select
                  compact
                  label="Via"
                  className={prop}
                  value={trigger.via}
                  onChange={(via) => setTrigger({ ...trigger, via })}
                  options={[
                    { value: "repost", label: "reposts, scraper" },
                    { value: "like", label: "likes, X API, first 20" },
                  ]}
                />
              </Prop>
            </>
          ) : trigger.kind === "agent_match" ? (
            <Prop label="Minimum score">
              <NumberInput
                value={trigger.minScore}
                onChange={(n) => setTrigger({ ...trigger, minScore: Math.min(100, n) })}
              />
            </Prop>
          ) : trigger.kind === "webhook" ? (
            <Prop label="URL" as="div">
              <span className="text-muted-foreground">
                {isNew ? "after saving" : "under Webhook above"}
              </span>
            </Prop>
          ) : null}
          {poll !== null ? (
            <p className="py-2 text-2xs text-muted-foreground">
              Polls X every {poll.every}: {usd(poll.usd)} a poll, up to{" "}
              {usd(poll.usd * poll.perDay)} a day{rule.dryRun ? ", not while a dry run" : ""}.
            </p>
          ) : null}
        </PropGroup>

        <PropGroup title="Only if">
          <Prop label="Within hours">
            <OptionalNumber
              placeholder="any"
              value={conditions.withinHours}
              onChange={(withinHours) => setConditions({ ...conditions, withinHours })}
            />
          </Prop>
          <Prop label="Link">
            <Select
              compact
              label="Link"
              className={prop}
              value={conditions.link}
              onChange={(link) => setConditions({ ...conditions, link })}
              options={[
                { value: undefined, label: "either" },
                { value: "has", label: "has a link" },
                { value: "none", label: "no link" },
              ]}
            />
          </Prop>
          <Prop label="Not a reply">
            <Switch
              checked={conditions.notReply === true}
              onChange={(on) => setConditions({ ...conditions, notReply: on ? true : undefined })}
            />
          </Prop>
          <Prop label="Author followers at least">
            <OptionalNumber
              placeholder="any"
              value={conditions.minAuthorFollowers}
              onChange={(minAuthorFollowers) =>
                setConditions({ ...conditions, minAuthorFollowers })
              }
            />
          </Prop>
          <Prop label="Not in list">
            <ListSelect
              none="any"
              value={conditions.notInListId}
              onChange={(notInListId) => setConditions({ ...conditions, notInListId })}
            />
          </Prop>
        </PropGroup>

        <PropGroup title="Then">
          <Prop label="Action">
            <Select
              compact
              label="Action"
              className={prop}
              value={action.kind}
              onChange={(kind) => setAction(ACTIONS[kind].init)}
              options={entries(ACTIONS)}
            />
          </Prop>
          {action.kind === "auto_plug" ? (
            <Prop label="Reply text">
              <input
                className={inputField("w-48")}
                value={action.text}
                placeholder="Full breakdown here: https://…"
                onChange={(e) => setAction({ ...action, text: e.target.value })}
              />
            </Prop>
          ) : action.kind === "auto_dm" ? (
            <Prop label="Template, {name}">
              <input
                className={inputField("w-48")}
                value={action.template}
                onChange={(e) => setAction({ ...action, template: e.target.value })}
              />
            </Prop>
          ) : action.kind === "notify" ? (
            <Prop label="Message, {name}">
              <input
                className={inputField("w-48")}
                value={action.message}
                onChange={(e) => setAction({ ...action, message: e.target.value })}
              />
            </Prop>
          ) : action.kind === "add_to_list" ? (
            <Prop label="List">
              <ListSelect
                none="pick a list"
                value={action.listId > 0 ? action.listId : undefined}
                onChange={(listId) => setAction({ ...action, listId: listId ?? 0 })}
              />
            </Prop>
          ) : action.kind === "auto_retweet" ? (
            <Prop label="Pick from my top posts">
              <Switch
                checked={action.evergreen}
                onChange={(evergreen) => setAction({ ...action, evergreen })}
              />
            </Prop>
          ) : action.kind === "auto_delete" ? (
            <>
              <Prop label="Older than days">
                <NumberInput
                  value={action.olderThanDays}
                  onChange={(olderThanDays) => setAction({ ...action, olderThanDays })}
                />
              </Prop>
              <Prop label="Under views">
                <NumberInput
                  width="w-24"
                  value={action.maxViews}
                  onChange={(maxViews) => setAction({ ...action, maxViews })}
                />
              </Prop>
            </>
          ) : action.kind === "clean_profile" ? (
            <Prop label="After hours">
              <NumberInput
                value={action.afterHours}
                onChange={(afterHours) => setAction({ ...action, afterHours })}
              />
            </Prop>
          ) : null}
          <Prop label="Wait minutes first">
            <NumberInput
              value={rule.waitMinutes}
              onChange={(waitMinutes) => edit({ ...rule, waitMinutes })}
            />
          </Prop>
          <Prop label="Undo after hours">
            <OptionalNumber
              placeholder="never"
              value={rule.undoAfterHours ?? undefined}
              onChange={(h) => edit({ ...rule, undoAfterHours: h ?? null })}
            />
          </Prop>
        </PropGroup>

        <PropGroup title="Limits">
          <Prop label="Budget per day, USD">
            <NumberInput
              step={0.1}
              width="w-24"
              value={rule.budgetUsdDay}
              onChange={(budgetUsdDay) => edit({ ...rule, budgetUsdDay })}
            />
          </Prop>
          <Prop label="Budget per month, USD">
            <NumberInput
              step={0.1}
              width="w-24"
              value={rule.budgetUsdMonth}
              onChange={(budgetUsdMonth) => edit({ ...rule, budgetUsdMonth })}
            />
          </Prop>
          <Prop label="Ask first, approve in Needs you">
            <Switch checked={rule.askFirst} onChange={(askFirst) => edit({ ...rule, askFirst })} />
          </Prop>
          <Prop label="Dry run, charge nothing">
            <Switch checked={rule.dryRun} onChange={(dryRun) => edit({ ...rule, dryRun })} />
          </Prop>
          {isNew ? (
            <Prop label="Enabled">
              <Switch checked={rule.enabled} onChange={(enabled) => edit({ ...rule, enabled })} />
            </Prop>
          ) : null}
        </PropGroup>
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background px-5 py-3">
        <span className="truncate font-mono text-2xs text-muted-foreground tabular-nums">
          {cost === null ? <Cost label="…" /> : <Cost usd={cost} />}
          {action.kind === "auto_delete" ? " per post" : " per fire"}
          {rule.undoAfterHours !== null
            ? ` + ${rates === null ? "…" : usd(rates.delete)} undo`
            : ""}
          {rule.dryRun ? ", dry run" : ""}
        </span>
        <span className="flex shrink-0 gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {isNew || dirty ? "Cancel" : "Close"}
          </Button>
          <Button size="sm" type="submit" disabled={saving || !valid || (!isNew && !dirty)}>
            <TextMorph duration={250}>
              {saving ? "Saving" : isNew ? "Create rule" : "Save"}
            </TextMorph>
          </Button>
        </span>
      </div>
    </form>
  );
}

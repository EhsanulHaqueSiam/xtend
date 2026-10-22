import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

/** Automate screen contracts: schemas, errors, method names and the RPC group. Owned by the automate area. */

export const Trigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("post_crosses_threshold"),
    metric: Schema.Literals(["views", "likes"]),
    threshold: NonNegativeInt,
  }),
  Schema.Struct({
    kind: Schema.Literal("schedule"),
    /** 0 = Sunday. */
    weekdays: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))),
    /** Local "HH:MM". */
    time: Schema.String.check(Schema.isPattern(/^\d{2}:\d{2}$/)),
  }),
  Schema.Struct({ kind: Schema.Literal("new_engager") }),
  Schema.Struct({ kind: Schema.Literal("keyword_post"), query: Schema.String }),
]);
export type Trigger = typeof Trigger.Type;

export const Action = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("auto_plug"), text: Schema.String }),
  /** `{name}` in the template becomes the engager's display name. */
  Schema.Struct({ kind: Schema.Literal("auto_dm"), template: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("auto_retweet"), evergreen: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("clean_profile"), afterHours: NonNegativeInt }),
  Schema.Struct({
    kind: Schema.Literal("auto_delete"),
    olderThanDays: NonNegativeInt,
    maxViews: NonNegativeInt,
  }),
  Schema.Struct({ kind: Schema.Literal("auto_like") }),
]);
export type Action = typeof Action.Type;

export const RuleInput = Schema.Struct({
  id: Schema.optional(Schema.Int),
  name: Schema.String,
  enabled: Schema.Boolean,
  trigger: Trigger,
  action: Action,
  budgetUsdMonth: Schema.Number,
  dryRun: Schema.Boolean,
});
export type RuleInput = typeof RuleInput.Type;

export const Rule = Schema.Struct({
  ...RuleInput.fields,
  id: Schema.Int,
  spentUsdMonth: Schema.Number,
  createdAt: IsoDateTime,
});
export type Rule = typeof Rule.Type;

export const RuleRunStatus = Schema.Literals(["ok", "failed", "skipped", "dry_run"]);
export type RuleRunStatus = typeof RuleRunStatus.Type;

export const RuleRun = Schema.Struct({
  id: Schema.Int,
  ruleId: Schema.Int,
  at: IsoDateTime,
  /** Post id, engager user id or schedule slot the rule fired on. */
  subjectId: Schema.String,
  status: RuleRunStatus,
  detail: Schema.String,
  costUsd: Schema.Number,
});
export type RuleRun = typeof RuleRun.Type;

/** One thing a rule would do right now, with what it would cost. */
export const RulePreview = Schema.Struct({
  ruleId: Schema.Int,
  ruleName: Schema.String,
  subjectId: Schema.String,
  description: Schema.String,
  costUsd: Schema.Number,
});
export type RulePreview = typeof RulePreview.Type;

const X_COST_USD = {
  post: 0.015,
  postWithLink: 0.2,
  like: 0.015,
  repost: 0.015,
  dm: 0.015,
  delete: 0.01,
};
// Same test as XClient.postCostUsd; duplicated so the rule form can price a draft without a round trip.
const hasLink = (text: string) => /https?:\/\/\S+|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(text);

/** Cost of one firing of `action`. auto_delete is per post; the engine multiplies. */
export const actionCostUsd = (action: Action): number => {
  switch (action.kind) {
    case "auto_plug":
      return hasLink(action.text) ? X_COST_USD.postWithLink : X_COST_USD.post;
    case "auto_dm":
      return X_COST_USD.dm;
    case "auto_retweet":
      return X_COST_USD.repost;
    case "auto_like":
      return X_COST_USD.like;
    case "auto_delete":
      return X_COST_USD.delete;
    case "clean_profile":
      return 0;
  }
};

export class AutomateError extends Schema.TaggedError<AutomateError>()("AutomateError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Automate failed during ${this.operation}: ${this.detail}`;
  }
}

export const Automate_METHODS = {
  rulesList: "automate.rulesList",
  ruleUpsert: "automate.ruleUpsert",
  ruleDelete: "automate.ruleDelete",
  ruleRunNow: "automate.ruleRunNow",
  preview: "automate.preview",
  runsList: "automate.runsList",
} as const;

export const AutomateRpcGroup = RpcGroup.make(
  Rpc.make(Automate_METHODS.rulesList, {
    payload: Schema.Struct({}),
    success: Schema.Array(Rule),
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.ruleUpsert, {
    payload: RuleInput,
    success: Rule,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.ruleDelete, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.Void,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.ruleRunNow, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.Array(RuleRun),
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.preview, {
    payload: Schema.Struct({}),
    success: Schema.Array(RulePreview),
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.runsList, {
    payload: Schema.Struct({
      ruleId: Schema.optional(Schema.Int),
      status: Schema.optional(RuleRunStatus),
    }),
    success: Schema.Array(RuleRun),
    error: AutomateError,
  }),
);

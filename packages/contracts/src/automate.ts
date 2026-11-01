import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XId } from "./baseSchemas.ts";
import { hasLink, type RateCard } from "./costs.ts";
import { Score } from "./leads.ts";

/** Automate screen contracts: schemas, errors, method names and the RPC group. Owned by the automate area. */

export const EngagementKind = Schema.Literals(["like", "repost"]);
export type EngagementKind = typeof EngagementKind.Type;

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
  /** Someone liked or reposted one given post; polled by the engine with dedupe. */
  Schema.Struct({ kind: Schema.Literal("post_engaged"), postId: XId, via: EngagementKind }),
  Schema.Struct({ kind: Schema.Literal("new_follower") }),
  /** A signal agent filed a person at or above this score. */
  Schema.Struct({ kind: Schema.Literal("agent_match"), minScore: Score }),
  /** A signed POST to the rule's webhook URL. */
  Schema.Struct({ kind: Schema.Literal("webhook") }),
]);
export type Trigger = typeof Trigger.Type;

/** Every field optional; an unset condition always passes. */
export const Conditions = Schema.Struct({
  withinHours: Schema.optional(NonNegativeInt),
  link: Schema.optional(Schema.Literals(["has", "none"])),
  notInListId: Schema.optional(Schema.Int),
  notReply: Schema.optional(Schema.Boolean),
  minAuthorFollowers: Schema.optional(NonNegativeInt),
});
export type Conditions = typeof Conditions.Type;

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
  Schema.Struct({ kind: Schema.Literal("unrepost") }),
  Schema.Struct({ kind: Schema.Literal("add_to_list"), listId: Schema.Int }),
  /** OS notification through a `rule_fired` event; `{name}` becomes the engager's name. */
  Schema.Struct({ kind: Schema.Literal("notify"), message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("follow") }),
]);
export type Action = typeof Action.Type;

export const RuleInput = Schema.Struct({
  id: Schema.optional(Schema.Int),
  name: Schema.String,
  enabled: Schema.Boolean,
  trigger: Trigger,
  conditions: Conditions,
  /** Minutes a subject must be old before the action runs. */
  waitMinutes: NonNegativeInt,
  action: Action,
  budgetUsdDay: Schema.Number,
  budgetUsdMonth: Schema.Number,
  /** Schedule the inverse action (unlike, unrepost, unfollow, delete) this many hours after a success. */
  undoAfterHours: Schema.NullOr(NonNegativeInt),
  /** Queue a pending request instead of acting; the Needs-you tab approves it. */
  askFirst: Schema.Boolean,
  dryRun: Schema.Boolean,
});
export type RuleInput = typeof RuleInput.Type;

export const Rule = Schema.Struct({
  ...RuleInput.fields,
  id: Schema.Int,
  spentUsdDay: Schema.Number,
  spentUsdMonth: Schema.Number,
  createdAt: IsoDateTime,
});
export type Rule = typeof Rule.Type;

export const RuleRunStatus = Schema.Literals(["ok", "failed", "skipped", "dry_run", "pending"]);
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
  /** The X id the action produced or acted on: the new post, the liked post, the followed user. */
  xId: Schema.NullOr(Schema.String),
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

export const PendingStatus = Schema.Literals(["pending", "approved", "dismissed"]);

export const PendingPreview = Schema.Struct({
  title: Schema.String,
  target: Schema.NullOr(Schema.Struct({ label: Schema.String, href: Schema.String })),
  message: Schema.NullOr(Schema.String),
  post: Schema.NullOr(Schema.Struct({ text: Schema.String, href: Schema.String })),
  /** All posts in a deletion batch, saved when the request was priced. */
  posts: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.String, href: Schema.String }))),
  because: Schema.String,
});
export type PendingPreview = typeof PendingPreview.Type;

/** An ask-first rule waiting for a click. */
export const PendingRequest = Schema.Struct({
  id: Schema.Int,
  ruleId: Schema.Int,
  ruleName: Schema.String,
  subjectId: Schema.String,
  description: Schema.String,
  /** Stored when queued; older requests may predate previews. */
  preview: Schema.optional(PendingPreview),
  costUsd: Schema.Number,
  createdAt: IsoDateTime,
  status: PendingStatus,
});
export type PendingRequest = typeof PendingRequest.Type;

/** What a rule would have done over the last 7 days of observed posts, engagers and followers. */
export const DryRunReport = Schema.Struct({
  fired: Schema.Array(
    Schema.Struct({ at: IsoDateTime, description: Schema.String, costUsd: Schema.Number }),
  ),
  totalUsd: Schema.Number,
});
export type DryRunReport = typeof DryRunReport.Type;

export const WebhookInfo = Schema.Struct({ path: Schema.String, secret: Schema.String });
export type WebhookInfo = typeof WebhookInfo.Type;

/** Cost of one firing of `action` at the service's rates. auto_delete is per post; the engine multiplies. */
export const actionCostUsd = (rates: RateCard, action: Action): number => {
  switch (action.kind) {
    case "auto_plug":
      return hasLink(action.text) ? rates.postWithLink : rates.post;
    case "auto_dm":
      return rates.dm;
    case "auto_retweet":
      return rates.repost;
    case "auto_like":
      return rates.like;
    case "auto_delete":
    case "unrepost":
      return rates.delete;
    case "follow":
      return rates.follow;
    case "clean_profile":
    case "add_to_list":
    case "notify":
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

export const isAutomateError = Schema.is(AutomateError);

export const Automate_METHODS = {
  rulesList: "automate.rulesList",
  ruleUpsert: "automate.ruleUpsert",
  ruleDelete: "automate.ruleDelete",
  ruleRunNow: "automate.ruleRunNow",
  preview: "automate.preview",
  runsList: "automate.runsList",
  pendingList: "automate.pendingList",
  pendingApprove: "automate.pendingApprove",
  pendingDismiss: "automate.pendingDismiss",
  dryRun7d: "automate.dryRun7d",
  webhookInfo: "automate.webhookInfo",
} as const;

const IdPayload = Schema.Struct({ id: Schema.Int });

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
    payload: IdPayload,
    success: Schema.Void,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.ruleRunNow, {
    payload: IdPayload,
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
  Rpc.make(Automate_METHODS.pendingList, {
    payload: Schema.Struct({}),
    success: Schema.Array(PendingRequest),
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.pendingApprove, {
    payload: IdPayload,
    success: RuleRun,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.pendingDismiss, {
    payload: IdPayload,
    success: Schema.Void,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.dryRun7d, {
    payload: IdPayload,
    success: DryRunReport,
    error: AutomateError,
  }),
  Rpc.make(Automate_METHODS.webhookInfo, {
    payload: IdPayload,
    success: WebhookInfo,
    error: AutomateError,
  }),
);

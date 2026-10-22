import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XId } from "./baseSchemas.ts";

/** Compose screen contracts: drafts, assist calls and the RPC group. Owned by the compose area. */

/** `posting` is a claim: whoever sets it (scheduler or Post now) is the only publisher of that draft. */
export const DraftStatus = Schema.Literals([
  "draft",
  "queued",
  "posting",
  "posted",
  "failed",
  "suggested",
]);
export type DraftStatus = typeof DraftStatus.Type;

export const DraftKind = Schema.Literals(["thread", "article"]);
export type DraftKind = typeof DraftKind.Type;

export const ReplySettings = Schema.Literals([
  "everyone",
  "following",
  "mentionedUsers",
  "verified",
]);
export type ReplySettings = typeof ReplySettings.Type;

export const DraftBlock = Schema.Struct({ text: Schema.String });
export type DraftBlock = typeof DraftBlock.Type;

export const DraftPoll = Schema.Struct({
  options: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  durationMinutes: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 10080 })),
});
export type DraftPoll = typeof DraftPoll.Type;

/** What the editor can change. Everything else on a Draft is owned by the service. */
export const DraftPatch = Schema.Struct({
  kind: Schema.optional(DraftKind),
  status: Schema.optional(DraftStatus),
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  blocks: Schema.optional(Schema.Array(DraftBlock)),
  replySettings: Schema.optional(ReplySettings),
  poll: Schema.optional(Schema.NullOr(DraftPoll)),
  hideLinkPreviews: Schema.optional(Schema.Boolean),
  threadDelaySeconds: Schema.optional(NonNegativeInt),
  /** URL of the post that inspired a suggested draft. */
  source: Schema.optional(Schema.NullOr(Schema.String)),
});
export type DraftPatch = typeof DraftPatch.Type;

export const Draft = Schema.Struct({
  id: Schema.String,
  kind: DraftKind,
  status: DraftStatus,
  /** Article title; threads leave it empty. */
  title: Schema.String,
  /** Article markdown body; threads leave it empty. */
  body: Schema.String,
  blocks: Schema.Array(DraftBlock),
  replySettings: ReplySettings,
  poll: Schema.NullOr(DraftPoll),
  /** Stored only; X's API has no switch for it yet. */
  hideLinkPreviews: Schema.Boolean,
  threadDelaySeconds: NonNegativeInt,
  source: Schema.NullOr(Schema.String),
  /** When the scheduler should post it. Set by queue, schedule and retry backoff. */
  scheduledAt: Schema.NullOr(IsoDateTime),
  postIds: Schema.Array(XId),
  /** Last X error detail, kept across retries so the UI can show why. */
  error: Schema.NullOr(Schema.String),
  attempts: NonNegativeInt,
  postedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Draft = typeof Draft.Type;

export const DraftList = Schema.Struct({ drafts: Schema.Array(Draft) });
export type DraftList = typeof DraftList.Type;

export const HookAlternatives = Schema.Struct({
  alternatives: Schema.Array(Schema.Struct({ text: Schema.String, reason: Schema.String })),
});
export type HookAlternatives = typeof HookAlternatives.Type;

export const RewriteVariants = Schema.Struct({ variants: Schema.Array(Schema.String) });
export type RewriteVariants = typeof RewriteVariants.Type;

export const ThreadIdeas = Schema.Struct({
  outlines: Schema.Array(
    Schema.Struct({ hook: Schema.String, beats: Schema.Array(Schema.String) }),
  ),
});
export type ThreadIdeas = typeof ThreadIdeas.Type;

export const ContinuedBlocks = Schema.Struct({ blocks: Schema.Array(Schema.String) });
export type ContinuedBlocks = typeof ContinuedBlocks.Type;

export const VoiceMatch = Schema.Struct({
  score: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  note: Schema.String,
  /** How many of the user's recent posts the comparison saw. */
  samples: NonNegativeInt,
});
export type VoiceMatch = typeof VoiceMatch.Type;

export class ComposeError extends Schema.TaggedError<ComposeError>()("ComposeError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Compose ${this.operation} failed: ${this.detail}`;
  }
}

export const Compose_METHODS = {
  draftsList: "compose.draftsList",
  draftCreate: "compose.draftCreate",
  draftUpdate: "compose.draftUpdate",
  draftDelete: "compose.draftDelete",
  postNow: "compose.postNow",
  assistHook: "compose.assistHook",
  assistRewrite: "compose.assistRewrite",
  assistThreadIdeas: "compose.assistThreadIdeas",
  assistContinue: "compose.assistContinue",
  assistVoiceMatch: "compose.assistVoiceMatch",
} as const;

const DraftId = Schema.Struct({ id: Schema.String });
const Blocks = Schema.Struct({ blocks: Schema.Array(Schema.String) });

export const ComposeRpcGroup = RpcGroup.make(
  Rpc.make(Compose_METHODS.draftsList, {
    payload: Schema.Struct({}),
    success: DraftList,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.draftCreate, {
    payload: DraftPatch,
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.draftUpdate, {
    payload: Schema.Struct({ ...DraftId.fields, patch: DraftPatch }),
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.draftDelete, {
    payload: DraftId,
    success: Schema.Void,
    error: ComposeError,
  }),
  /** Posts the thread right away. The returned draft is posted or failed with the X error detail. */
  Rpc.make(Compose_METHODS.postNow, { payload: DraftId, success: Draft, error: ComposeError }),
  Rpc.make(Compose_METHODS.assistHook, {
    payload: Blocks,
    success: HookAlternatives,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistRewrite, {
    payload: Schema.Struct({ text: Schema.String }),
    success: RewriteVariants,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistThreadIdeas, {
    payload: Schema.Struct({ topic: Schema.String }),
    success: ThreadIdeas,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistContinue, {
    payload: Blocks,
    success: ContinuedBlocks,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistVoiceMatch, {
    payload: Blocks,
    success: VoiceMatch,
    error: ComposeError,
  }),
);

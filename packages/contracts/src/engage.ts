import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, XId } from "./baseSchemas.ts";
import { XApiError, XPost } from "./x.ts";

/** Engage screen contracts: schemas, errors, method names and the RPC group. Owned by the engage area. */

export const ReplyTarget = Schema.Struct({
  post: XPost,
  keyword: Schema.String,
  ageMinutes: Schema.Finite,
  viewsPerHour: Schema.Finite,
  /** Expected reach: views per hour, boosted by reply velocity and author size. */
  score: Schema.Finite,
  replied: Schema.Boolean,
});
export type ReplyTarget = typeof ReplyTarget.Type;

export const ReplyDraft = Schema.Struct({ text: Schema.String });
export type ReplyDraft = typeof ReplyDraft.Type;

/** One reply attempt, kept whether X accepted it or not. */
export const SentReply = Schema.Struct({
  id: Schema.Int,
  targetPostId: XId,
  targetUrl: Schema.String,
  targetHandle: Schema.String,
  text: Schema.String,
  postId: Schema.NullOr(XId),
  error: Schema.NullOr(Schema.String),
  at: IsoDateTime,
});
export type SentReply = typeof SentReply.Type;

export const Mention = Schema.Struct({
  post: XPost,
  /** "api" is X's mentions endpoint (paid); "session" is what the desktop observed (free). */
  source: Schema.Literals(["api", "session"]),
  handled: Schema.Boolean,
});
export type Mention = typeof Mention.Type;

export class EngageError extends Schema.TaggedError<EngageError>()("EngageError", {
  operation: Schema.Literals(["store", "assist", "settings"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Engage ${this.operation} failed: ${this.detail}`;
  }
}

export const Engage_METHODS = {
  targets: "engage.targets",
  draftReply: "engage.draftReply",
  reply: "engage.reply",
  like: "engage.like",
  findKeywords: "engage.findKeywords",
  mentions: "engage.mentions",
  mentionHandled: "engage.mentionHandled",
  inbox: "engage.inbox",
} as const;

export const EngageRpcGroup = RpcGroup.make(
  Rpc.make(Engage_METHODS.targets, {
    payload: Schema.Struct({}),
    success: Schema.Array(ReplyTarget),
    error: Schema.Union([EngageError, XApiError]),
  }),
  Rpc.make(Engage_METHODS.draftReply, {
    payload: Schema.Struct({ post: XPost }),
    success: Schema.Array(ReplyDraft),
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.reply, {
    payload: Schema.Struct({ post: XPost, text: Schema.String }),
    success: SentReply,
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.like, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.Void,
    error: XApiError,
  }),
  Rpc.make(Engage_METHODS.findKeywords, {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      keywords: Schema.Array(Schema.String),
      handles: Schema.Array(Schema.String),
    }),
    error: Schema.Union([EngageError, XApiError]),
  }),
  Rpc.make(Engage_METHODS.mentions, {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      mentions: Schema.Array(Mention),
      /** Set when X's own-account mentions call failed; session mentions still list. */
      apiError: Schema.NullOr(Schema.String),
    }),
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.mentionHandled, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.Void,
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.inbox, {
    payload: Schema.Struct({}),
    success: Schema.Struct({
      sent: Schema.Array(SentReply),
      followUps: Schema.Array(SentReply),
    }),
    error: EngageError,
  }),
);

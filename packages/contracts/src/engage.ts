import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XId } from "./baseSchemas.ts";
import { XApiError, XPost } from "./x.ts";

/** Engage screen contracts: schemas, errors, method names and the RPC group. Owned by the engage area. */

export const ReplyTarget = Schema.Struct({
  post: XPost,
  keyword: Schema.String,
  ageMinutes: Schema.Finite,
  viewsPerHour: Schema.Finite,
  /** Ranking only: views per hour times author reach, damped by how crowded the replies already are. */
  score: Schema.Finite,
  /** Views-per-hour band the post is in; what a reply can expect to be seen under. */
  reach: Schema.Literals(["under 100/h", "100 to 1k/h", "1k to 10k/h", "10k+/h"]),
  replied: Schema.Boolean,
  /** The author's latest Scores sample, when one exists. */
  authorScore: Schema.NullOr(Schema.Number),
  /** Replies the user already sent to this author. */
  repliesToAuthor: NonNegativeInt,
});
export type ReplyTarget = typeof ReplyTarget.Type;

/** The taste a reply draft takes; the chooser offers these in this order. */
export const ReplyTone = Schema.Literals([
  "agree",
  "add",
  "ask",
  "contrarian",
  "sarcastic",
  "warm",
  "short",
]);
export type ReplyTone = typeof ReplyTone.Type;

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
  /** New followers within 24 h of the reply who are its author or engaged with the user since. */
  attributedFollowers: NonNegativeInt,
});
export type SentReply = typeof SentReply.Type;

export const Mention = Schema.Struct({
  post: XPost,
  /** "api" is X's mentions endpoint (paid); "session" is what the desktop observed (free). */
  source: Schema.Literals(["api", "session"]),
  handled: Schema.Boolean,
});
export type Mention = typeof Mention.Type;

export const NicheProfile = Schema.Struct({
  /** Accounts the user replies to most, from the session capture and replies sent here. */
  handles: Schema.Array(Schema.Struct({ handle: Schema.String, replies: NonNegativeInt })),
  topics: Schema.Array(Schema.String),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type NicheProfile = typeof NicheProfile.Type;

export const DmEvent = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  text: Schema.String,
  senderId: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.String),
});
export type DmEvent = typeof DmEvent.Type;

export class EngageError extends Schema.TaggedError<EngageError>()("EngageError", {
  operation: Schema.Literals(["store", "assist", "settings", "session"]),
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
  nicheProfile: "engage.nicheProfile",
  nicheRebuild: "engage.nicheRebuild",
  dms: "engage.dms",
} as const;

export const EngageRpcGroup = RpcGroup.make(
  Rpc.make(Engage_METHODS.targets, {
    payload: Schema.Struct({}),
    success: Schema.Array(ReplyTarget),
    error: Schema.Union([EngageError, XApiError]),
  }),
  Rpc.make(Engage_METHODS.draftReply, {
    payload: Schema.Struct({ post: XPost, tone: Schema.optional(ReplyTone) }),
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
  /** Session mentions and the mentions already fetched are free; `refresh` pays for one page of newer ones. */
  Rpc.make(Engage_METHODS.mentions, {
    payload: Schema.Struct({ refresh: Schema.optional(Schema.Boolean) }),
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
      /** Replies and quotes to the user's own posts that the session saw. */
      incoming: Schema.Array(Mention),
    }),
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.nicheProfile, {
    payload: Schema.Struct({}),
    success: NicheProfile,
    error: EngageError,
  }),
  Rpc.make(Engage_METHODS.nicheRebuild, {
    payload: Schema.Struct({}),
    success: NicheProfile,
    error: EngageError,
  }),
  /** `load: false` is free and only returns the quote; `load: true` pays X for one page of DM events. */
  Rpc.make(Engage_METHODS.dms, {
    payload: Schema.Struct({ load: Schema.Boolean }),
    success: Schema.Struct({
      events: Schema.Array(DmEvent),
      error: Schema.NullOr(Schema.String),
      quoteUsd: Schema.Number,
    }),
    error: EngageError,
  }),
);

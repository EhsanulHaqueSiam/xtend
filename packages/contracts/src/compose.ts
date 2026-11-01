import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, ReplyTone, XId } from "./baseSchemas.ts";
import { LINK_PATTERN } from "./costs.ts";

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

/** A block's own reply control wins over the draft's. */
export const DraftBlock = Schema.Struct({
  text: Schema.String,
  replySettings: Schema.optional(ReplySettings),
});
export type DraftBlock = typeof DraftBlock.Type;

export const MediaKind = Schema.Literals(["image", "video"]);
export type MediaKind = typeof MediaKind.Type;

/** One file under `<baseDir>/media/<draftId>/`, attached to block `blockIndex` at `position`. */
export const DraftMedia = Schema.Struct({
  id: Schema.String,
  blockIndex: NonNegativeInt,
  path: Schema.String,
  kind: MediaKind,
  alt: Schema.String,
  position: NonNegativeInt,
});
export type DraftMedia = typeof DraftMedia.Type;

/** What the editor may change on attached media: where it sits and its alt text. Files come in through mediaAdd. */
export const DraftMediaPatch = Schema.Struct({
  id: Schema.String,
  blockIndex: NonNegativeInt,
  alt: Schema.String,
  position: NonNegativeInt,
});
export type DraftMediaPatch = typeof DraftMediaPatch.Type;

/** 15 MB per file; X refuses larger images anyway. */
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
export const MEDIA_MAX_IMAGES = 4;

/** X's limit on a post's weighted length (`charCount`). */
export const POST_LIMIT = 280;

// The contract's link rule, so the counter and the price agree with what the service charges.
const LINK = new RegExp(LINK_PATTERN.source, "gi");

// X's weighting (twitter-text v3): code points in these ranges count 1, every other one 2
// (CJK, most symbols), an emoji sequence 2 however many code points it joins, a link 23.
const LIGHT: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];
const EMOJI = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}|\u20E3/u;
const graphemes = new Intl.Segmenter();

/** The length X checks against POST_LIMIT; the editor's counter and the publisher's refusal. */
export const charCount = (text: string) => {
  let count = 0;
  for (const { segment } of graphemes.segment(
    text.normalize("NFC").replace(LINK, "x".repeat(23)),
  )) {
    if (EMOJI.test(segment)) count += 2;
    else
      for (const ch of segment) {
        const cp = ch.codePointAt(0) ?? 0;
        count += LIGHT.some(([from, to]) => cp >= from && cp <= to) ? 1 : 2;
      }
  }
  return count;
};

export const DraftPoll = Schema.Struct({
  options: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  durationMinutes: Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 10080 })),
});
export type DraftPoll = typeof DraftPoll.Type;

/** What the editor can change. Everything else on a Draft is owned by the service. */
export const DraftPatch = Schema.Struct({
  kind: Schema.optional(DraftKind),
  /** Queued, posting, posted and failed are the service's to set: through Plan and the publisher. */
  status: Schema.optional(Schema.Literals(["draft", "suggested"])),
  title: Schema.optional(Schema.String),
  body: Schema.optional(Schema.String),
  blocks: Schema.optional(Schema.Array(DraftBlock)),
  replySettings: Schema.optional(ReplySettings),
  poll: Schema.optional(Schema.NullOr(DraftPoll)),
  hideLinkPreviews: Schema.optional(Schema.Boolean),
  threadDelaySeconds: Schema.optional(NonNegativeInt),
  /** URL of the post that inspired a suggested draft. */
  source: Schema.optional(Schema.NullOr(Schema.String)),
  /** x.com status link appended to the first post; a real quote once treg exposes quote_tweet_id. */
  quoteUrl: Schema.optional(Schema.NullOr(Schema.String)),
  /** The first post goes out as a reply to this post. */
  replyToPostId: Schema.optional(Schema.NullOr(XId)),
  media: Schema.optional(Schema.Array(DraftMediaPatch)),
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
  /** Not applied yet: X's API has no switch for it and nothing removes the card after posting. */
  hideLinkPreviews: Schema.Boolean,
  /** What happened to the hide request at publish time. */
  linkPreviewNote: Schema.NullOr(Schema.String),
  threadDelaySeconds: NonNegativeInt,
  source: Schema.NullOr(Schema.String),
  quoteUrl: Schema.NullOr(Schema.String),
  replyToPostId: Schema.NullOr(XId),
  /** X's article draft id once created; publish retries reuse it. */
  articleId: Schema.NullOr(Schema.String),
  media: Schema.Array(DraftMedia),
  /** When the scheduler should post it. Set by queue, schedule and retry backoff. */
  scheduledAt: Schema.NullOr(IsoDateTime),
  /** The posts already on X, in block order. A retry resumes after them; editing what they say starts over. */
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

/** Options for the next posts of a thread, each a run of posts to append. */
export const ContinuedBlocks = Schema.Struct({
  options: Schema.Array(Schema.Struct({ blocks: Schema.Array(Schema.String) })),
});
export type ContinuedBlocks = typeof ContinuedBlocks.Type;

/** Seen posts of the user's own that make a voice sample without reading X. */
export const VOICE_MIN_SEEN = 5;

export const VoiceMatch = Schema.Struct({
  score: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  note: Schema.String,
  /** How many of the user's recent posts the comparison saw. */
  samples: NonNegativeInt,
});
export type VoiceMatch = typeof VoiceMatch.Type;

/** Prices the service pays for things outside the X rate card: X Articles and the cover model. */
export const ComposeQuote = Schema.Struct({
  articleUsd: Schema.Number,
  coverUsd: Schema.Number,
  coverModel: Schema.String,
});
export type ComposeQuote = typeof ComposeQuote.Type;

/** What the assist panel shows beside a draft: where it would land and whether the desktop can post media. */
export const ComposeContext = Schema.Struct({
  nextSlot: Schema.NullOr(IsoDateTime),
  bestHours: Schema.Array(Schema.Struct({ weekday: Schema.Int, hour: Schema.Int })),
  desktopConnected: Schema.Boolean,
});
export type ComposeContext = typeof ComposeContext.Type;

export class ComposeError extends Schema.TaggedError<ComposeError>()("ComposeError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Compose ${this.operation} failed: ${this.detail}`;
  }
}

export const isComposeError = Schema.is(ComposeError);

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
  mediaAdd: "compose.mediaAdd",
  mediaRemove: "compose.mediaRemove",
  generateCover: "compose.generateCover",
  quote: "compose.quote",
  context: "compose.context",
} as const;

const DraftId = Schema.Struct({ id: Schema.String });
const Blocks = Schema.Struct({ blocks: Schema.Array(Schema.String) });
const tone = Schema.optional(ReplyTone);
const ToneBlocks = Schema.Struct({ blocks: Schema.Array(Schema.String), tone });

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
  Rpc.make(Compose_METHODS.postNow, {
    payload: Schema.Struct({
      ...DraftId.fields,
      /** Only through the user's session: refused, never sent through the paid API. */
      sessionOnly: Schema.optional(Schema.Boolean),
    }),
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistHook, {
    payload: ToneBlocks,
    success: HookAlternatives,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistRewrite, {
    payload: Schema.Struct({ text: Schema.String, tone }),
    success: RewriteVariants,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistThreadIdeas, {
    payload: Schema.Struct({ topic: Schema.String, tone }),
    success: ThreadIdeas,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistContinue, {
    payload: ToneBlocks,
    success: ContinuedBlocks,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.assistVoiceMatch, {
    payload: Blocks,
    success: VoiceMatch,
    error: ComposeError,
  }),
  /** Stores one file (base64, at most MEDIA_MAX_BYTES) under the base dir and returns the draft with it attached. */
  Rpc.make(Compose_METHODS.mediaAdd, {
    payload: Schema.Struct({
      draftId: Schema.String,
      blockIndex: NonNegativeInt,
      kind: MediaKind,
      /** Original file name; only its extension is kept. */
      name: Schema.String,
      base64: Schema.String,
      alt: Schema.optional(Schema.String),
    }),
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.mediaRemove, {
    payload: Schema.Struct({ draftId: Schema.String, id: Schema.String }),
    success: Draft,
    error: ComposeError,
  }),
  /** Paid: one image from the cover model in `compose.quote`, attached to the article as its cover. */
  Rpc.make(Compose_METHODS.generateCover, {
    payload: Schema.Struct({ draftId: Schema.String, prompt: Schema.String }),
    success: Draft,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.quote, {
    payload: Schema.Struct({}),
    success: ComposeQuote,
    error: ComposeError,
  }),
  Rpc.make(Compose_METHODS.context, {
    payload: Schema.Struct({}),
    success: ComposeContext,
    error: ComposeError,
  }),
);

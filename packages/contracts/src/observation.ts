import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, XHandle, XId } from "./baseSchemas.ts";

/**
 * What the desktop reads off the session view's own GraphQL traffic. Public
 * metrics only: the numbers X renders to every visitor. Non-public metrics
 * (profile visits, link clicks) come from the per-post analytics page later.
 */
export const PostMetrics = Schema.Struct({
  views: Schema.NullOr(NonNegativeInt),
  likes: NonNegativeInt,
  reposts: NonNegativeInt,
  replies: NonNegativeInt,
  quotes: NonNegativeInt,
  bookmarks: NonNegativeInt,
});
export type PostMetrics = typeof PostMetrics.Type;

export const ObservedAuthor = Schema.Struct({
  userId: XId,
  handle: XHandle,
  name: Schema.String,
  followers: Schema.NullOr(NonNegativeInt),
  verified: Schema.Boolean,
  /** A protected account: its posts are visible only to approved followers and never leave the machine. */
  isProtected: Schema.optional(Schema.Boolean),
});
export type ObservedAuthor = typeof ObservedAuthor.Type;

export const ObservedPost = Schema.Struct({
  postId: XId,
  author: ObservedAuthor,
  text: Schema.String,
  createdAt: IsoDateTime,
  isReply: Schema.Boolean,
  /** The outer retweet wrapper; the author is the reposter, not the writer. */
  isRepost: Schema.Boolean,
  /** An ad X slotted into the timeline. */
  isPromoted: Schema.Boolean,
  hasMedia: Schema.Boolean,
  hasLink: Schema.Boolean,
  metrics: PostMetrics,
});
export type ObservedPost = typeof ObservedPost.Type;

/** Which X surface produced the batch; later the overlay and analytics weight sources differently. */
export const ObservationSource = Schema.Literals([
  "home",
  "profile",
  "detail",
  "search",
  "notifications",
  "other",
]);
export type ObservationSource = typeof ObservationSource.Type;

export const ObservationBatch = Schema.Struct({
  /** Handle of the logged-in account the session view belongs to, when known. */
  viewerHandle: Schema.NullOr(XHandle),
  /**
   * The Xtend account whose session view captured the batch. A batch queued while the service was
   * away may arrive after a switch; it still belongs to this account, not the current one.
   */
  accountId: Schema.optional(Schema.Int),
  source: ObservationSource,
  observedAt: IsoDateTime,
  posts: Schema.Array(ObservedPost),
});
export type ObservationBatch = typeof ObservationBatch.Type;

export const ObservationRecordResult = Schema.Struct({
  posts: NonNegativeInt,
});
export type ObservationRecordResult = typeof ObservationRecordResult.Type;

/** A post as the UI lists it: the latest metrics plus when it was first and last seen. */
export const ObservedPostSummary = Schema.Struct({
  ...ObservedPost.fields,
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  observations: NonNegativeInt,
});
export type ObservedPostSummary = typeof ObservedPostSummary.Type;

export const ObservationListRecentInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
  authorHandle: Schema.optional(XHandle),
});
export type ObservationListRecentInput = typeof ObservationListRecentInput.Type;

export const ObservationListRecentResult = Schema.Struct({
  posts: Schema.Array(ObservedPostSummary),
});
export type ObservationListRecentResult = typeof ObservationListRecentResult.Type;

export class ObservationStoreError extends Schema.TaggedError<ObservationStoreError>()(
  "ObservationStoreError",
  {
    operation: Schema.Literals(["record", "listRecent"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Observation store failed during ${this.operation}.`;
  }
}

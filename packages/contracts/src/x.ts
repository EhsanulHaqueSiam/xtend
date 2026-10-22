import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, XHandle, XId } from "./baseSchemas.ts";

/**
 * One X post as every suite screen sees it, whichever provider or session
 * surface produced it. Providers return their own shapes; the service's X
 * client normalizes to this before anything else touches the data.
 */
export const XPost = Schema.Struct({
  postId: XId,
  url: Schema.String,
  text: Schema.String,
  createdAt: IsoDateTime,
  lang: Schema.NullOr(Schema.String),
  isReply: Schema.Boolean,
  isRepost: Schema.Boolean,
  hasMedia: Schema.Boolean,
  hasLink: Schema.Boolean,
  author: Schema.Struct({
    userId: XId,
    handle: XHandle,
    name: Schema.String,
    followers: Schema.NullOr(NonNegativeInt),
    verified: Schema.Boolean,
    avatarUrl: Schema.NullOr(Schema.String),
  }),
  metrics: Schema.Struct({
    views: Schema.NullOr(NonNegativeInt),
    likes: NonNegativeInt,
    reposts: NonNegativeInt,
    replies: NonNegativeInt,
    quotes: NonNegativeInt,
    bookmarks: NonNegativeInt,
  }),
});
export type XPost = typeof XPost.Type;

export const XProfile = Schema.Struct({
  userId: XId,
  handle: XHandle,
  name: Schema.String,
  bio: Schema.String,
  followers: NonNegativeInt,
  following: NonNegativeInt,
  posts: NonNegativeInt,
  verified: Schema.Boolean,
  avatarUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(IsoDateTime),
  location: Schema.NullOr(Schema.String),
  website: Schema.NullOr(Schema.String),
});
export type XProfile = typeof XProfile.Type;

/** A follower row as the scraper returns it: enough for the score engine and bot check. */
export const XFollower = Schema.Struct({
  userId: XId,
  handle: XHandle,
  name: Schema.String,
  followers: NonNegativeInt,
  following: NonNegativeInt,
  verified: Schema.Boolean,
  bio: Schema.String,
  createdAt: Schema.NullOr(IsoDateTime),
});
export type XFollower = typeof XFollower.Type;

export const XTrend = Schema.Struct({
  name: Schema.String,
  context: Schema.NullOr(Schema.String),
  postCount: Schema.NullOr(NonNegativeInt),
});
export type XTrend = typeof XTrend.Type;

export const XSearchMode = Schema.Literals(["top", "latest"]);
export type XSearchMode = typeof XSearchMode.Type;

export class XApiError extends Schema.TaggedError<XApiError>()("XApiError", {
  /** treg endpoint id or own-tool path that failed. */
  endpoint: Schema.String,
  reason: Schema.Literals(["no_token", "http", "provider", "decode", "budget"]),
  status: Schema.NullOr(Schema.Int),
  detail: Schema.String,
}) {
  override get message(): string {
    return `X call ${this.endpoint} failed (${this.reason}): ${this.detail}`;
  }
}

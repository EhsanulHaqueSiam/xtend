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

/**
 * Clean X: what the desktop hides inside x.com, one CSS rule set per toggle and never
 * script. The ids travel from Settings to the desktop; the CSS lives there.
 */
export const X_SKIN_TOGGLES = [
  { id: "ads", label: "Hide ads", on: true },
  { id: "grok", label: "Hide Grok", on: true },
  { id: "upsells", label: "Hide Premium upsells", on: true },
  { id: "chrome", label: "Hide X's nav rail and right column", on: true },
  { id: "discover", label: "Hide Discover more and More posts under a thread", on: true },
  { id: "boosts", label: "Hide reply boosts and Subscribe", on: true },
  { id: "extras", label: "Hide Communities, Jobs and Spaces", on: true },
  { id: "forYou", label: "Hide the For you tab", on: false },
  { id: "views", label: "Hide view counts", on: false },
  { id: "badges", label: "Hide verified badges", on: false },
  { id: "quietMedia", label: "Quiet media until hover", on: false },
] as const;
export type XSkinToggle = (typeof X_SKIN_TOGGLES)[number]["id"];

export const isXSkinToggle = (id: unknown): id is XSkinToggle =>
  X_SKIN_TOGGLES.some((t) => t.id === id);

export const X_SKIN_DEFAULTS: ReadonlyArray<XSkinToggle> = X_SKIN_TOGGLES.filter((t) => t.on).map(
  (t) => t.id,
);

import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XHandle, XId } from "./baseSchemas.ts";
import { XProfile } from "./x.ts";

/** Analyze screen contracts: schemas, errors, method names and the RPC group. Owned by the analyze area. */

export const PostKind = Schema.Literals(["text", "media", "link", "reply", "thread"]);
export type PostKind = typeof PostKind.Type;

/** One of the connected account's own posts, cached from the X timeline scrape. */
export const AccountPost = Schema.Struct({
  postId: XId,
  url: Schema.String,
  text: Schema.String,
  createdAt: IsoDateTime,
  kind: PostKind,
  views: Schema.NullOr(NonNegativeInt),
  likes: NonNegativeInt,
  reposts: NonNegativeInt,
  replies: NonNegativeInt,
  quotes: NonNegativeInt,
  bookmarks: NonNegativeInt,
});
export type AccountPost = typeof AccountPost.Type;

/** One row per handle per calendar day, written whenever the profile is fetched. */
export const ProfileSnapshot = Schema.Struct({
  day: Schema.String,
  followers: NonNegativeInt,
  following: NonNegativeInt,
  posts: NonNegativeInt,
});
export type ProfileSnapshot = typeof ProfileSnapshot.Type;

/** Average views per hour of week over the cached posts. weekday 0 is Sunday, hours are UTC. */
export const HeatmapCell = Schema.Struct({
  weekday: Schema.Int,
  hour: Schema.Int,
  posts: NonNegativeInt,
  avgViews: Schema.Number,
});
export type HeatmapCell = typeof HeatmapCell.Type;

export const Theme = Schema.Struct({
  name: Schema.String,
  why: Schema.String,
  postIds: Schema.Array(Schema.String),
});
export type Theme = typeof Theme.Type;

export const AnalyzeData = Schema.Struct({
  handle: Schema.NullOr(XHandle),
  fetchedAt: Schema.NullOr(IsoDateTime),
  posts: Schema.Array(AccountPost),
  snapshots: Schema.Array(ProfileSnapshot),
  heatmap: Schema.Array(HeatmapCell),
});
export type AnalyzeData = typeof AnalyzeData.Type;

/** An author the session saw, ranked by reach and how often they showed up. */
export const Engager = Schema.Struct({
  handle: XHandle,
  name: Schema.String,
  followers: Schema.NullOr(NonNegativeInt),
  verified: Schema.Boolean,
  seen: NonNegativeInt,
});
export type Engager = typeof Engager.Type;

export const CompetitorReport = Schema.Struct({
  handle: XHandle,
  fetchedAt: IsoDateTime,
  profile: Schema.NullOr(XProfile),
  avgViews: Schema.Number,
  topPosts: Schema.Array(AccountPost),
});
export type CompetitorReport = typeof CompetitorReport.Type;

export const AskAnswer = Schema.Struct({
  answer: Schema.String,
  followUps: Schema.Array(Schema.String),
});
export type AskAnswer = typeof AskAnswer.Type;

export class AnalyzeError extends Schema.TaggedError<AnalyzeError>()("AnalyzeError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Analyze ${this.operation} failed: ${this.detail}`;
  }
}

export const Analyze_METHODS = {
  data: "analyze.data",
  refresh: "analyze.refresh",
  engagers: "analyze.engagers",
  themes: "analyze.themes",
  competitors: "analyze.competitors",
  competitorFetch: "analyze.competitorFetch",
  ask: "analyze.ask",
} as const;

export const AnalyzeRpcGroup = RpcGroup.make(
  Rpc.make(Analyze_METHODS.data, {
    payload: Schema.Struct({}),
    success: AnalyzeData,
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.refresh, {
    payload: Schema.Struct({}),
    success: AnalyzeData,
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.engagers, {
    payload: Schema.Struct({}),
    success: Schema.Array(Engager),
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.themes, {
    payload: Schema.Struct({}),
    success: Schema.Array(Theme),
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.competitors, {
    payload: Schema.Struct({}),
    success: Schema.Array(CompetitorReport),
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.competitorFetch, {
    payload: Schema.Struct({ handle: XHandle }),
    success: CompetitorReport,
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.ask, {
    payload: Schema.Struct({ question: Schema.String }),
    success: AskAnswer,
    error: AnalyzeError,
  }),
);

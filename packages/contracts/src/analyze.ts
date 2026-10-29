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

/** Average views per hour of week over the cached posts. weekday 0 is Sunday, hours are in the account time zone. */
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

/** Totals over the posts published in the last `days` days. */
export const AnalyzeWindow = Schema.Struct({
  days: Schema.Int,
  posts: NonNegativeInt,
  views: NonNegativeInt,
  likes: NonNegativeInt,
  replies: NonNegativeInt,
  reposts: NonNegativeInt,
  /** Total engagements over total views, so big posts weigh what they are worth. */
  engagementRate: Schema.Number,
});
export type AnalyzeWindow = typeof AnalyzeWindow.Type;

/** X's private per-post metrics, one row per post per fetch day. Only the connected account's own posts have them. */
export const PostAnalytics = Schema.Struct({
  postId: XId,
  day: Schema.String,
  impressions: NonNegativeInt,
  profileVisits: NonNegativeInt,
  linkClicks: NonNegativeInt,
  follows: NonNegativeInt,
  likes: NonNegativeInt,
  replies: NonNegativeInt,
  reposts: NonNegativeInt,
});
export type PostAnalytics = typeof PostAnalytics.Type;

/** The nightly non-public job: its last outcome and the newest row per post. */
export const NonPublic = Schema.Struct({
  lastRun: Schema.NullOr(
    Schema.Struct({
      at: IsoDateTime,
      posts: NonNegativeInt,
      /** The XApiError message when the job failed; "provider" means the treg X connection is down. */
      error: Schema.NullOr(Schema.String),
    }),
  ),
  byPost: Schema.Array(PostAnalytics),
  /** Whether the paid nightly read runs; null until the first Fetch now, which turns it on. */
  nightly: Schema.NullOr(Schema.Boolean),
});
export type NonPublic = typeof NonPublic.Type;

/** What the desktop overlay shows under each own post. `vsAverage` is impressions over the 30-day mean. */
export const PostStripEntry = Schema.Struct({
  postId: XId,
  impressions: NonNegativeInt,
  er: Schema.Number,
  profileVisits: NonNegativeInt,
  follows: NonNegativeInt,
  vsAverage: Schema.NullOr(Schema.Number),
});
export type PostStripEntry = typeof PostStripEntry.Type;

/** The service does the maths; the UI only renders these. */
export const AnalyzeData = Schema.Struct({
  handle: Schema.NullOr(XHandle),
  /** From the newest profile snapshot; the compose preview wants it. */
  avatarUrl: Schema.NullOr(Schema.String),
  fetchedAt: Schema.NullOr(IsoDateTime),
  /** Own posts only; reposts are dropped at refresh. */
  posts: Schema.Array(AccountPost),
  snapshots: Schema.Array(ProfileSnapshot),
  heatmap: Schema.Array(HeatmapCell),
  timeZone: Schema.String,
  windows: Schema.Array(AnalyzeWindow),
  /** Lifetime views of the posts published on each day, last 30 days. X exposes no per-day impressions. */
  viewsByPostDay: Schema.Array(
    Schema.Struct({ day: Schema.String, posts: NonNegativeInt, views: NonNegativeInt }),
  ),
  /** Follower change against the newest snapshot at least 30 days old; null until one exists. */
  followerDelta30d: Schema.NullOr(Schema.Struct({ delta: Schema.Int, sinceDay: Schema.String })),
  nonPublic: NonPublic,
});
export type AnalyzeData = typeof AnalyzeData.Type;

/** An account the session view showed most, ranked by reach and sightings. Not engagement data: the session carries none. */
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
  refreshNonPublic: "analyze.refreshNonPublic",
  nightlySet: "analyze.nightlySet",
  postStrip: "analyze.postStrip",
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
  /** Paid: one analytics read per own post of the last 30 days. Runs nightly too. */
  Rpc.make(Analyze_METHODS.refreshNonPublic, {
    payload: Schema.Struct({}),
    success: AnalyzeData,
    error: AnalyzeError,
  }),
  /** Turns the nightly private-metrics read on or off for the current account. */
  Rpc.make(Analyze_METHODS.nightlySet, {
    payload: Schema.Struct({ on: Schema.Boolean }),
    success: AnalyzeData,
    error: AnalyzeError,
  }),
  Rpc.make(Analyze_METHODS.postStrip, {
    payload: Schema.Struct({ postIds: Schema.Array(XId) }),
    success: Schema.Array(PostStripEntry),
    error: AnalyzeError,
  }),
);

import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XHandle } from "./baseSchemas.ts";
import { XFollower, XTrend } from "./x.ts";

/** Scores screen contracts: schemas, errors, method names and the RPC group. Owned by the scores area. */

export const Tier = Schema.Literals(["Unknown", "Noted", "Credible", "Significant", "Supreme"]);
export type Tier = typeof Tier.Type;

/** A follower with the points it contributed to the score. */
export const TopFollower = Schema.Struct({
  ...XFollower.fields,
  points: Schema.Number,
});
export type TopFollower = typeof TopFollower.Type;

export const BotReport = Schema.Struct({
  /** 0..1 share of sampled followers that look like bots. */
  botShare: Schema.Number,
  /** Account followers divided by following; null when following is 0. */
  followRatio: Schema.NullOr(Schema.Number),
  suspicious: Schema.Array(XFollower),
});
export type BotReport = typeof BotReport.Type;

/** One score run; the store keeps the latest per handle per day. */
export const ScoreSample = Schema.Struct({
  handle: XHandle,
  at: IsoDateTime,
  score: Schema.Number,
  tier: Tier,
  followers: NonNegativeInt,
  /** How many followers the run read, over how many pages. The score is over the top SCORE_TOP_K of them by reach. */
  sampled: NonNegativeInt,
  pages: NonNegativeInt,
  botShare: Schema.Number,
  topFollowers: Schema.Array(TopFollower),
  bot: BotReport,
});
export type ScoreSample = typeof ScoreSample.Type;

export const ScoreReport = Schema.Struct({
  handle: XHandle,
  latest: Schema.NullOr(ScoreSample),
  history: Schema.Array(Schema.Struct({ at: IsoDateTime, score: Schema.Number })),
});
export type ScoreReport = typeof ScoreReport.Type;

export const WatchEntry = Schema.Struct({
  handle: XHandle,
  addedAt: IsoDateTime,
  score: Schema.NullOr(Schema.Number),
  tier: Schema.NullOr(Tier),
  change7d: Schema.NullOr(Schema.Number),
});
export type WatchEntry = typeof WatchEntry.Type;

export class ScoresError extends Schema.TaggedError<ScoresError>()("ScoresError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Scores ${this.operation} failed: ${this.detail}`;
  }
}

export const Scores_METHODS = {
  report: "scores.report",
  run: "scores.run",
  watchList: "scores.watchList",
  watchAdd: "scores.watchAdd",
  watchRemove: "scores.watchRemove",
  trending: "scores.trending",
} as const;

const HandlePayload = Schema.Struct({ handle: XHandle });

export const ScoresRpcGroup = RpcGroup.make(
  Rpc.make(Scores_METHODS.report, {
    payload: HandlePayload,
    success: ScoreReport,
    error: ScoresError,
  }),
  Rpc.make(Scores_METHODS.run, {
    payload: HandlePayload,
    success: ScoreReport,
    error: ScoresError,
  }),
  Rpc.make(Scores_METHODS.watchList, {
    payload: Schema.Struct({}),
    success: Schema.Array(WatchEntry),
    error: ScoresError,
  }),
  Rpc.make(Scores_METHODS.watchAdd, {
    payload: HandlePayload,
    success: Schema.Array(WatchEntry),
    error: ScoresError,
  }),
  Rpc.make(Scores_METHODS.watchRemove, {
    payload: HandlePayload,
    success: Schema.Array(WatchEntry),
    error: ScoresError,
  }),
  Rpc.make(Scores_METHODS.trending, {
    payload: Schema.Struct({ country: Schema.String }),
    success: Schema.Array(XTrend),
    error: ScoresError,
  }),
);

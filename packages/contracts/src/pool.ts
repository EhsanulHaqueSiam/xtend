import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, XHandle, XId } from "./baseSchemas.ts";

/**
 * The shared pool: every install's public sightings, pooled, so trends come
 * from everyone's X. The service pushes while Settings.poolSharing is on and
 * reads the two trend views for free either way. Owned by the pool area.
 */

export const PoolHotPost = Schema.Struct({
  postId: XId,
  handle: XHandle,
  text: Schema.String,
  createdAt: IsoDateTime,
  /** Installs that saw it. */
  sightings: Schema.Int,
  views24h: Schema.NullOr(Schema.Int),
  likes24h: Schema.NullOr(Schema.Int),
  reposts24h: Schema.NullOr(Schema.Int),
});
export type PoolHotPost = typeof PoolHotPost.Type;

export const PoolRisingTerm = Schema.Struct({
  word: Schema.String,
  today: Schema.Int,
  perDayBefore: Schema.Number,
  lift: Schema.Number,
});
export type PoolRisingTerm = typeof PoolRisingTerm.Type;

export const PoolTrends = Schema.Struct({
  /** Public posts and installs in the pool, for the freshness line. */
  posts: Schema.Int,
  installs: Schema.Int,
  fetchedAt: IsoDateTime,
  hot: Schema.Array(PoolHotPost),
  rising: Schema.Array(PoolRisingTerm),
});
export type PoolTrends = typeof PoolTrends.Type;

export class PoolError extends Schema.TaggedError<PoolError>()("PoolError", {
  reason: Schema.Literals(["http", "decode"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Pool ${this.reason}: ${this.detail}`;
  }
}

export const Pool_METHODS = {
  trends: "pool.trends",
} as const;

export const PoolRpcGroup = RpcGroup.make(
  Rpc.make(Pool_METHODS.trends, {
    payload: Schema.Struct({}),
    success: PoolTrends,
    error: PoolError,
  }),
);

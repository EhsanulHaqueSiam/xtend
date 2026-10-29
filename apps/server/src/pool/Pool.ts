import {
  type ObservationBatch,
  type ObservedPost,
  PoolError,
  type PoolTrends,
} from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as SettingsStore from "../settings/SettingsStore.ts";

/** The worker in front of the pool (apps/pool). It alone holds the database. */
const POOL_URL = process.env.XTEND_POOL_URL ?? "https://xtend-pool.search-shim.workers.dev";
/** The worker refuses larger pushes; a session batch is far smaller. */
const MAX_ITEMS = 500;
const HOT_LIMIT = 50;
const RISING_LIMIT = 30;

const Register = Schema.fromJsonString(Schema.Struct({ installId: Schema.String }));
const HotRows = Schema.fromJsonString(
  Schema.Struct({
    posts: Schema.Int,
    installs: Schema.Int,
    rows: Schema.Array(
      Schema.Struct({
        post_id: Schema.String,
        handle: Schema.String,
        text: Schema.String,
        created_at: Schema.String,
        sightings: Schema.Int,
        views_24h: Schema.NullOr(Schema.Int),
        likes_24h: Schema.NullOr(Schema.Int),
        reposts_24h: Schema.NullOr(Schema.Int),
      }),
    ),
  }),
);
const RisingRows = Schema.fromJsonString(
  Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({
        word: Schema.String,
        today: Schema.Int,
        per_day_before: Schema.Number,
        lift: Schema.Number,
      }),
    ),
  }),
);

/** Surfaces whose posts are public by construction. Notifications and unknown pages stay home. */
const SHARED_SOURCES: ReadonlySet<ObservationBatch["source"]> = new Set([
  "home",
  "profile",
  "detail",
  "search",
]);

/**
 * What one sighting sends: the public post, its author and the numbers seen. Promoted items,
 * repost wrappers and every author not positively read as public stay home; so does
 * everything about the viewer.
 */
export const toItems = (posts: ReadonlyArray<ObservedPost>) =>
  posts
    .filter((p) => !p.isPromoted && !p.isRepost && p.author.isProtected === false)
    .slice(0, MAX_ITEMS)
    .map((p) => ({
      post: {
        postId: p.postId,
        text: p.text,
        createdAt: p.createdAt,
        isReply: p.isReply,
        hasMedia: p.hasMedia,
        hasLink: p.hasLink,
        author: {
          userId: p.author.userId,
          handle: p.author.handle,
          name: p.author.name,
          followers: p.author.followers,
          verified: p.author.verified,
        },
      },
      metrics: p.metrics,
    }));

export class Pool extends Context.Service<
  Pool,
  {
    /** Sends a batch's public posts to the pool in the background; never fails the caller. */
    readonly push: (batch: ObservationBatch) => Effect.Effect<void>;
    /** The pool's hot posts and rising terms. Free. */
    readonly trends: Effect.Effect<PoolTrends, PoolError>;
  }
>()("xtend/pool/Pool") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* SettingsStore.SettingsStore;
  const scope = yield* Effect.scope;

  const httpError = (detail: unknown) =>
    new PoolError({ reason: "http", detail: String(detail).slice(0, 300) });
  const decodeError = (detail: unknown) =>
    new PoolError({ reason: "decode", detail: String(detail).slice(0, 300) });

  /** The body of a 2xx answer; any other status is the worker's refusal, kept as the detail. */
  const call = Effect.fn("Pool.call")(function* (request: HttpClientRequest.HttpClientRequest) {
    const response = yield* http.execute(request).pipe(Effect.mapError(httpError));
    const text = yield* response.text.pipe(Effect.mapError(httpError));
    if (response.status < 200 || response.status >= 300)
      return yield* httpError(`${response.status} ${text}`);
    return { status: response.status, text };
  });

  const register = Effect.fn("Pool.register")(function* () {
    const { text } = yield* call(HttpClientRequest.post(new URL("/register", POOL_URL).href));
    const { installId } = yield* Schema.decodeUnknownEffect(Register)(text).pipe(
      Effect.mapError(decodeError),
    );
    yield* sql`UPDATE settings SET pool_install_id = ${installId} WHERE id = 1`.pipe(
      Effect.mapError(httpError),
    );
    return installId;
  });

  const installId = Effect.gen(function* () {
    const [row] = yield* sql<{ pool_install_id: string | null }>`
      SELECT pool_install_id FROM settings WHERE id = 1
    `.pipe(Effect.mapError(httpError));
    return row?.pool_install_id ?? (yield* register());
  });

  const send = Effect.fn("Pool.send")(function* (batch: ObservationBatch) {
    const { poolSharing } = yield* settings.get.pipe(Effect.mapError(httpError));
    if (!poolSharing || !SHARED_SOURCES.has(batch.source)) return;
    const items = toItems(batch.posts);
    if (items.length === 0) return;
    const push = (install: string) =>
      call(
        HttpClientRequest.post(new URL("/push", POOL_URL).href).pipe(
          HttpClientRequest.setHeader("x-install", install),
          HttpClientRequest.bodyJsonUnsafe({ items }),
        ),
      );
    // An install the pool forgot (a wiped database behind the worker) is re-registered once.
    yield* push(yield* installId).pipe(
      Effect.catchIf(
        (e) => e.detail.startsWith("401"),
        () => Effect.flatMap(register(), push),
      ),
    );
  });

  const push = (batch: ObservationBatch) =>
    send(batch).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("pool push failed", Cause.squash(cause)).pipe(Effect.ignore),
      ),
      Effect.forkIn(scope),
      Effect.asVoid,
    );

  const trends = Effect.gen(function* () {
    const get = (path: string) => call(HttpClientRequest.get(new URL(path, POOL_URL).href));
    const [hot, rising] = yield* Effect.all(
      [get(`/trends/hot?limit=${HOT_LIMIT}`), get(`/trends/rising?limit=${RISING_LIMIT}`)],
      { concurrency: 2 },
    );
    const h = yield* Schema.decodeUnknownEffect(HotRows)(hot.text).pipe(
      Effect.mapError(decodeError),
    );
    const r = yield* Schema.decodeUnknownEffect(RisingRows)(rising.text).pipe(
      Effect.mapError(decodeError),
    );
    return {
      posts: h.posts,
      installs: h.installs,
      fetchedAt: DateTime.formatIso(yield* DateTime.now),
      hot: h.rows.map((x) => ({
        postId: x.post_id,
        handle: x.handle,
        text: x.text,
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(x.created_at)),
        sightings: x.sightings,
        views24h: x.views_24h,
        likes24h: x.likes_24h,
        reposts24h: x.reposts_24h,
      })),
      rising: r.rows.map((x) => ({
        word: x.word,
        today: x.today,
        perDayBefore: x.per_day_before,
        lift: x.lift,
      })),
    } satisfies PoolTrends;
  });

  return Pool.of({ push, trends });
});

export const layer = Layer.effect(Pool, make);

/** A pool that takes nothing and has nothing, for tests and the offline CLI. */
export const layerNoop = Layer.succeed(Pool)(
  Pool.of({
    push: () => Effect.void,
    trends: Effect.fail(new PoolError({ reason: "http", detail: "no pool" })),
  }),
);

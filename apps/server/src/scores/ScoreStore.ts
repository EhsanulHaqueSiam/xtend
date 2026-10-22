import {
  BotReport,
  type ScoreSample,
  ScoresError,
  type Tier,
  TopFollower,
  type WatchEntry,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const TopFollowersJson = Schema.fromJsonString(Schema.Array(TopFollower));
const BotJson = Schema.fromJsonString(BotReport);

interface SampleRow {
  readonly handle: string;
  readonly at: string;
  readonly score: number;
  readonly tier: Tier;
  readonly followers: number;
  readonly sampled: number;
  readonly bot_share: number;
  readonly top_followers_json: string;
  readonly bot_json: string;
}

const toSample = (r: SampleRow): ScoreSample => ({
  handle: r.handle,
  at: r.at,
  score: r.score,
  tier: r.tier,
  followers: r.followers,
  sampled: r.sampled,
  botShare: r.bot_share,
  topFollowers: Schema.decodeUnknownSync(TopFollowersJson)(r.top_followers_json),
  bot: Schema.decodeUnknownSync(BotJson)(r.bot_json),
});

/** Score samples (one per handle per day) and the watch table Analyze competitors share. */
export class ScoreStore extends Context.Service<
  ScoreStore,
  {
    readonly saveSample: (sample: ScoreSample) => Effect.Effect<void, ScoresError>;
    readonly latest: (handle: string) => Effect.Effect<ScoreSample | null, ScoresError>;
    readonly history: (
      handle: string,
    ) => Effect.Effect<ReadonlyArray<{ at: string; score: number }>, ScoresError>;
    readonly watchList: Effect.Effect<ReadonlyArray<WatchEntry>, ScoresError>;
    readonly watchAdd: (handle: string, at: string) => Effect.Effect<void, ScoresError>;
    readonly watchRemove: (handle: string) => Effect.Effect<void, ScoresError>;
  }
>()("xtend/scores/ScoreStore") {}

const fail = (operation: string) => (cause: { readonly message: string }) =>
  new ScoresError({ operation, detail: cause.message });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const saveSample = Effect.fn("ScoreStore.saveSample")(
    function* (s: ScoreSample) {
      yield* sql`
        INSERT INTO score_samples (handle, day, at, score, tier, followers, sampled, bot_share, top_followers_json, bot_json)
        VALUES (${s.handle}, ${s.at.slice(0, 10)}, ${s.at}, ${s.score}, ${s.tier}, ${s.followers}, ${s.sampled}, ${s.botShare},
                ${Schema.encodeSync(TopFollowersJson)(s.topFollowers)}, ${Schema.encodeSync(BotJson)(s.bot)})
        ON CONFLICT(handle, day) DO UPDATE SET
          at = excluded.at, score = excluded.score, tier = excluded.tier, followers = excluded.followers,
          sampled = excluded.sampled, bot_share = excluded.bot_share,
          top_followers_json = excluded.top_followers_json, bot_json = excluded.bot_json
      `;
    },
    Effect.mapError(fail("saveSample")),
  );

  const latest = Effect.fn("ScoreStore.latest")(
    function* (handle: string) {
      const rows = yield* sql<SampleRow>`
        SELECT * FROM score_samples WHERE handle = ${handle} ORDER BY day DESC LIMIT 1
      `;
      return rows[0] === undefined ? null : toSample(rows[0]);
    },
    Effect.mapError(fail("latest")),
  );

  const history = Effect.fn("ScoreStore.history")(
    function* (handle: string) {
      return yield* sql<{ at: string; score: number }>`
        SELECT at, score FROM score_samples WHERE handle = ${handle} ORDER BY day ASC LIMIT 365
      `;
    },
    Effect.mapError(fail("history")),
  );

  // Latest sample per handle plus the newest sample at least 7 days old for the change column.
  const watchList = sql<{
    handle: string;
    added_at: string;
    score: number | null;
    tier: Tier | null;
    previous: number | null;
  }>`
    SELECT w.handle, w.added_at, s.score, s.tier,
      (SELECT score FROM score_samples p WHERE p.handle = w.handle AND p.day <= date('now', '-7 days') ORDER BY p.day DESC LIMIT 1) AS previous
    FROM watch w
    LEFT JOIN score_samples s ON s.handle = w.handle
      AND s.day = (SELECT MAX(day) FROM score_samples WHERE handle = w.handle)
    ORDER BY w.added_at DESC
  `.pipe(
    Effect.map((rows) =>
      rows.map((r): WatchEntry => ({
        handle: r.handle,
        addedAt: r.added_at,
        score: r.score,
        tier: r.tier,
        change7d: r.score === null || r.previous === null ? null : r.score - r.previous,
      })),
    ),
    Effect.mapError(fail("watchList")),
  );

  const watchAdd = Effect.fn("ScoreStore.watchAdd")(
    function* (handle: string, at: string) {
      const count = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM watch`;
      if ((count[0]?.n ?? 0) >= 100)
        return yield* new ScoresError({ operation: "watchAdd", detail: "watchlist is full (100)" });
      yield* sql`INSERT OR IGNORE INTO watch (handle, added_at) VALUES (${handle}, ${at})`;
    },
    Effect.mapError(fail("watchAdd")),
  );

  const watchRemove = Effect.fn("ScoreStore.watchRemove")(
    function* (handle: string) {
      yield* sql`DELETE FROM watch WHERE handle = ${handle}`;
    },
    Effect.mapError(fail("watchRemove")),
  );

  return ScoreStore.of({ saveSample, latest, history, watchList, watchAdd, watchRemove });
});

export const layer = Layer.effect(ScoreStore, make);

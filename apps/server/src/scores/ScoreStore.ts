import {
  BotReport,
  CategoryCount,
  type ProfileChange,
  type ScoreSample,
  ScoresError,
  type Tier,
  TopFollower,
  type WatchEntry,
  type XProfile,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";

const TopFollowersJson = Schema.fromJsonString(Schema.Array(TopFollower));
const CategoriesJson = Schema.fromJsonString(Schema.Array(CategoryCount));
const BotJson = Schema.fromJsonString(BotReport);
const FollowerJson = Schema.fromJsonString(TopFollower);

interface SampleRow {
  readonly handle: string;
  readonly at: string;
  readonly score: number;
  readonly tier: Tier;
  readonly followers: number;
  readonly sampled: number;
  readonly pages: number;
  readonly bot_share: number;
  readonly top_followers_json: string;
  readonly categories_json: string;
  readonly bot_json: string;
}

const toSample = (r: SampleRow): ScoreSample => ({
  handle: r.handle,
  at: r.at,
  score: r.score,
  tier: r.tier,
  followers: r.followers,
  sampled: r.sampled,
  pages: r.pages,
  botShare: r.bot_share,
  topFollowers: Schema.decodeUnknownSync(TopFollowersJson)(r.top_followers_json),
  categories: Schema.decodeUnknownSync(CategoriesJson)(r.categories_json),
  bot: Schema.decodeUnknownSync(BotJson)(r.bot_json),
});

/** One sample's scored set, keyed by the day it was taken. */
export interface ScoredSet {
  readonly at: string;
  readonly followers: ReadonlyArray<TopFollower>;
}

/** Score samples (one per handle per day), their scored follower sets, profile snapshots and the watch table Analyze competitors share. */
export class ScoreStore extends Context.Service<
  ScoreStore,
  {
    /** Writes the day's sample and replaces the scored set behind it. */
    readonly saveSample: (
      sample: ScoreSample,
      scored: ReadonlyArray<TopFollower>,
    ) => Effect.Effect<void, ScoresError>;
    readonly latest: (handle: string) => Effect.Effect<ScoreSample | null, ScoresError>;
    readonly history: (
      handle: string,
    ) => Effect.Effect<ReadonlyArray<{ at: string; score: number }>, ScoresError>;
    /** The two newest scored sets, newest first; fewer when fewer samples exist. */
    readonly latestScoredSets: (
      handle: string,
    ) => Effect.Effect<ReadonlyArray<ScoredSet>, ScoresError>;
    /** One profile snapshot per handle per day; the newest write of a day wins. */
    readonly saveProfile: (profile: XProfile, day: string) => Effect.Effect<void, ScoresError>;
    /** Days the name or bio changed, oldest first, plus the newest avatar. */
    readonly profileHistory: (
      handle: string,
    ) => Effect.Effect<
      { readonly changes: ReadonlyArray<ProfileChange>; readonly avatarUrl: string | null },
      ScoresError
    >;
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
    function* (s: ScoreSample, scored: ReadonlyArray<TopFollower>) {
      const day = s.at.slice(0, 10);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO score_samples (handle, day, at, score, tier, followers, sampled, pages, bot_share, top_followers_json, categories_json, bot_json)
            VALUES (${s.handle}, ${day}, ${s.at}, ${s.score}, ${s.tier}, ${s.followers}, ${s.sampled}, ${s.pages}, ${s.botShare},
                    ${Schema.encodeSync(TopFollowersJson)(s.topFollowers)}, ${Schema.encodeSync(CategoriesJson)(s.categories)}, ${Schema.encodeSync(BotJson)(s.bot)})
            ON CONFLICT(handle, day) DO UPDATE SET
              at = excluded.at, score = excluded.score, tier = excluded.tier, followers = excluded.followers,
              sampled = excluded.sampled, pages = excluded.pages, bot_share = excluded.bot_share,
              top_followers_json = excluded.top_followers_json, categories_json = excluded.categories_json, bot_json = excluded.bot_json
          `;
          yield* sql`DELETE FROM score_sample_followers WHERE handle = ${s.handle} AND day = ${day}`;
          yield* Effect.forEach(
            scored,
            (f) => sql`
              INSERT INTO score_sample_followers (handle, day, user_id, follower_json, points)
              VALUES (${s.handle}, ${day}, ${f.userId}, ${Schema.encodeSync(FollowerJson)(f)}, ${f.points})
            `,
            { discard: true },
          );
        }),
      );
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

  const latestScoredSets = Effect.fn("ScoreStore.latestScoredSets")(
    function* (handle: string) {
      const days = yield* sql<{ day: string; at: string }>`
        SELECT day, at FROM score_samples WHERE handle = ${handle} ORDER BY day DESC LIMIT 2
      `;
      return yield* Effect.forEach(days, (d) =>
        Effect.map(
          sql<{ follower_json: string }>`
            SELECT follower_json FROM score_sample_followers WHERE handle = ${handle} AND day = ${d.day}
          `,
          (rows): ScoredSet => ({
            at: d.at,
            followers: rows.map((r) => Schema.decodeUnknownSync(FollowerJson)(r.follower_json)),
          }),
        ),
      );
    },
    Effect.mapError(fail("latestScoredSets")),
  );

  const saveProfile = Effect.fn("ScoreStore.saveProfile")(
    function* (p: XProfile, day: string) {
      yield* sql`
        INSERT INTO profile_snapshots (handle, day, followers, following, posts, name, bio, avatar_url)
        VALUES (${p.handle}, ${day}, ${p.followers}, ${p.following}, ${p.posts}, ${p.name}, ${p.bio}, ${p.avatarUrl})
        ON CONFLICT(handle, day) DO UPDATE SET
          followers = excluded.followers, following = excluded.following, posts = excluded.posts,
          name = excluded.name, bio = excluded.bio, avatar_url = excluded.avatar_url
      `;
    },
    Effect.mapError(fail("saveProfile")),
  );

  const profileHistory = Effect.fn("ScoreStore.profileHistory")(
    function* (handle: string) {
      const rows = yield* sql<{
        day: string;
        followers: number;
        name: string | null;
        bio: string | null;
        avatar_url: string | null;
      }>`
        SELECT day, followers, name, bio, avatar_url FROM profile_snapshots
        WHERE handle = ${handle} AND name IS NOT NULL ORDER BY day ASC LIMIT 365
      `;
      const changes: Array<ProfileChange> = [];
      for (const r of rows) {
        const last = changes.at(-1);
        const name = r.name ?? "";
        const bio = r.bio ?? "";
        if (last === undefined || last.name !== name || last.bio !== bio)
          changes.push({ day: r.day, name, bio, followers: r.followers });
      }
      return { changes, avatarUrl: rows.at(-1)?.avatar_url ?? null };
    },
    Effect.mapError(fail("profileHistory")),
  );

  // Latest sample per handle plus the newest sample at least N days old for each change window.
  const watchList = sql<{
    handle: string;
    added_at: string;
    score: number | null;
    tier: Tier | null;
    d1: number | null;
    d7: number | null;
    d14: number | null;
    d30: number | null;
  }>`
    SELECT w.handle, w.added_at, s.score, s.tier,
      (SELECT score FROM score_samples p WHERE p.handle = w.handle AND p.day <= date('now', '-1 days') ORDER BY p.day DESC LIMIT 1) AS d1,
      (SELECT score FROM score_samples p WHERE p.handle = w.handle AND p.day <= date('now', '-7 days') ORDER BY p.day DESC LIMIT 1) AS d7,
      (SELECT score FROM score_samples p WHERE p.handle = w.handle AND p.day <= date('now', '-14 days') ORDER BY p.day DESC LIMIT 1) AS d14,
      (SELECT score FROM score_samples p WHERE p.handle = w.handle AND p.day <= date('now', '-30 days') ORDER BY p.day DESC LIMIT 1) AS d30
    FROM watch w
    LEFT JOIN score_samples s ON s.handle = w.handle
      AND s.day = (SELECT MAX(day) FROM score_samples WHERE handle = w.handle)
    WHERE w.account_id = ${sql.literal(CURRENT_ACCOUNT)}
    ORDER BY w.added_at DESC
  `.pipe(
    Effect.map((rows) =>
      rows.map((r): WatchEntry => {
        const delta = (previous: number | null) =>
          r.score === null || previous === null ? null : r.score - previous;
        return {
          handle: r.handle,
          addedAt: r.added_at,
          score: r.score,
          tier: r.tier,
          change: { d1: delta(r.d1), d7: delta(r.d7), d14: delta(r.d14), d30: delta(r.d30) },
        };
      }),
    ),
    Effect.mapError(fail("watchList")),
  );

  const watchAdd = Effect.fn("ScoreStore.watchAdd")(
    function* (handle: string, at: string) {
      const count = yield* sql<{
        n: number;
      }>`SELECT COUNT(*) AS n FROM watch WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
      if ((count[0]?.n ?? 0) >= 100)
        return yield* new ScoresError({ operation: "watchAdd", detail: "watchlist is full (100)" });
      yield* sql`INSERT OR IGNORE INTO watch (handle, added_at) VALUES (${handle.toLowerCase()}, ${at})`;
    },
    Effect.mapError(fail("watchAdd")),
  );

  const watchRemove = Effect.fn("ScoreStore.watchRemove")(
    function* (handle: string) {
      yield* sql`DELETE FROM watch WHERE handle = ${handle.toLowerCase()}`;
    },
    Effect.mapError(fail("watchRemove")),
  );

  return ScoreStore.of({
    saveSample,
    latest,
    history,
    latestScoredSets,
    saveProfile,
    profileHistory,
    watchList,
    watchAdd,
    watchRemove,
  });
});

export const layer = Layer.effect(ScoreStore, make);

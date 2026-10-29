import { AnalyzeError, type NonPublic, type PostAnalytics as Row } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as Treg from "../x/Treg.ts";
import { RATE_CARD } from "../x/XClient.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
// shortcut: X takes up to 100 ids per analytics request; raise if the posts window ever grows past it.
const IDS_PER_CALL = 100;
/** Local hour the nightly job runs at, in the account's zone. */
const RUN_HOUR = 3;
const TICK = "5 minutes";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** X names the metric; we store the few the screens use. */
const METRIC_KEYS: Record<string, keyof Omit<Row, "postId" | "day">> = {
  impressions: "impressions",
  profile_visits: "profileVisits",
  url_link_clicks: "linkClicks",
  link_clicks: "linkClicks",
  user_follows: "follows",
  follows: "follows",
  likes: "likes",
  replies: "replies",
  retweets: "reposts",
  reposts: "reposts",
};

/** `{ data: [{ id, measurement: { metrics_total: [{ metric_type, value }] | metrics_timeseries: [{ metrics: [...] }] } }] }` */
const parseAnalytics = (body: unknown, day: string): ReadonlyArray<Row> =>
  arr(obj(body).data).flatMap((item) => {
    const it = obj(item);
    const id = str(it.id);
    if (id === "") return [];
    const row: { -readonly [K in keyof Row]: Row[K] } = {
      postId: id,
      day,
      impressions: 0,
      profileVisits: 0,
      linkClicks: 0,
      follows: 0,
      likes: 0,
      replies: 0,
      reposts: 0,
    };
    const measurement = obj(it.measurement);
    // The total already sums the series; a body carrying both must not count each metric twice.
    const total = arr(measurement.metrics_total);
    const metrics =
      total.length > 0
        ? total
        : arr(measurement.metrics_timeseries).flatMap((t) => arr(obj(t).metrics));
    for (const m of metrics) {
      const key = METRIC_KEYS[str(obj(m).metric_type)];
      const value = obj(m).value;
      if (key !== undefined && typeof value === "number")
        row[key] += Math.max(0, Math.trunc(value));
    }
    return [row];
  });

/**
 * X's private per-post metrics for the connected account, fetched through the
 * team's own X tool in treg. A failed run is recorded, never thrown: the screen
 * shows why there is no data and the next night tries again.
 */
export class PostAnalytics extends Context.Service<
  PostAnalytics,
  {
    /** Paid: one analytics read per own post of the last 30 days, at the user's click; the first one turns the nightly run on. */
    readonly refresh: Effect.Effect<void, AnalyzeError>;
    readonly current: Effect.Effect<NonPublic, AnalyzeError>;
    /** Turns the current account's nightly run on or off. */
    readonly setNightly: (on: boolean) => Effect.Effect<void, AnalyzeError>;
    /** Runs `refresh` when it is RUN_HOUR in the account's zone, the nightly run is on, and today has no run yet. */
    readonly nightlyTick: Effect.Effect<void, AnalyzeError>;
  }
>()("xtend/analyze/PostAnalytics") {}

const fail = (operation: string) => (cause: { readonly message: string }) =>
  new AnalyzeError({ operation, detail: cause.message });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const treg = yield* Treg.Treg;
  const settings = yield* SettingsStore.SettingsStore;
  const store = yield* AnalyticsStore.AnalyticsStore;

  const fetchRows = (ids: ReadonlyArray<string>, now: DateTime.DateTime) =>
    Effect.gen(function* () {
      const end = DateTime.formatIso(now);
      const start = DateTime.formatIso(DateTime.subtract(now, { days: WINDOW_DAYS }));
      const rows: Array<Row> = [];
      for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
        const batch = ids.slice(i, i + IDS_PER_CALL);
        const response = yield* treg.call({
          endpoint: "x/2/tweets/analytics",
          method: "GET",
          query: { ids: batch.join(","), start_time: start, end_time: end, granularity: "total" },
          purpose: "analyze.nonPublic",
          expectedCostUsd: RATE_CARD.readPage * batch.length,
        });
        rows.push(...parseAnalytics(response.body, end.slice(0, 10)));
      }
      return rows;
    });

  const refresh = Effect.fn("PostAnalytics.refresh")(
    function* (manual: boolean) {
      const { handle } = yield* settings.get;
      if (handle === null) return;
      const now = yield* DateTime.now;
      const nowMs = DateTime.toEpochMillis(now);
      const { posts } = yield* store.listPosts(handle);
      const ids = posts
        .filter((p) => nowMs - Date.parse(p.createdAt) < WINDOW_DAYS * DAY_MS)
        .map((p) => p.postId);
      const result = yield* fetchRows(ids, now).pipe(
        Effect.map((rows) => ({ rows, error: null })),
        Effect.catchTag("XApiError", (e) =>
          Effect.succeed({ rows: [] as ReadonlyArray<Row>, error: e.message }),
        ),
      );
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT OR REPLACE INTO post_analytics_runs (at, posts, error, manual)
            VALUES (${DateTime.formatIso(now)}, ${result.rows.length}, ${result.error}, ${manual ? 1 : 0})
          `;
          // The first Fetch now turns the nightly run on; a switch the user set stays as set.
          if (manual)
            yield* sql`
              INSERT OR IGNORE INTO post_analytics_nightly (account_id, enabled)
              VALUES (${sql.literal(CURRENT_ACCOUNT)}, 1)
            `;
          yield* Effect.forEach(
            result.rows,
            (r) => sql`
              INSERT OR REPLACE INTO post_analytics (post_id, day, impressions, profile_visits, link_clicks, follows, likes, replies, reposts)
              VALUES (${r.postId}, ${r.day}, ${r.impressions}, ${r.profileVisits}, ${r.linkClicks}, ${r.follows}, ${r.likes}, ${r.replies}, ${r.reposts})
            `,
            { discard: true },
          );
        }),
      );
    },
    Effect.mapError(fail("nonPublic")),
  );

  const current = Effect.gen(function* () {
    const runs = yield* sql<{ at: string; posts: number; error: string | null }>`
      SELECT at, posts, error FROM post_analytics_runs
      WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY at DESC LIMIT 1
    `;
    const rows = yield* sql<{
      post_id: string;
      day: string;
      impressions: number;
      profile_visits: number;
      link_clicks: number;
      follows: number;
      likes: number;
      replies: number;
      reposts: number;
    }>`
      SELECT * FROM post_analytics a
      WHERE a.account_id = ${sql.literal(CURRENT_ACCOUNT)}
        AND day = (SELECT MAX(day) FROM post_analytics WHERE post_id = a.post_id)
      ORDER BY day DESC LIMIT 200
    `;
    const nightly = yield* sql<{ enabled: number }>`
      SELECT enabled FROM post_analytics_nightly WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}
    `;
    const lastRun = runs[0];
    return {
      nightly: nightly[0] === undefined ? null : nightly[0].enabled === 1,
      lastRun: lastRun === undefined ? null : lastRun,
      byPost: rows.map((r): Row => ({
        postId: r.post_id,
        day: r.day,
        impressions: r.impressions,
        profileVisits: r.profile_visits,
        linkClicks: r.link_clicks,
        follows: r.follows,
        likes: r.likes,
        replies: r.replies,
        reposts: r.reposts,
      })),
    } satisfies NonPublic;
  }).pipe(Effect.mapError(fail("nonPublic")));

  const nightlyTick = Effect.gen(function* () {
    const { timeZone } = yield* settings.get;
    const zone = SettingsStore.zoneOf(timeZone);
    const now = DateTime.setZone(yield* DateTime.now, zone);
    if (DateTime.toParts(now).hour !== RUN_HOUR) return;
    // Each night is a paid read per recent post: it runs once the priced Fetch now turned it on,
    // until the user turns it off.
    const optedIn = yield* sql`
      SELECT 1 FROM post_analytics_nightly WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} AND enabled = 1`;
    if (optedIn.length === 0) return;
    const today = DateTime.formatIsoDate(now);
    const last = yield* sql<{
      at: string;
    }>`SELECT at FROM post_analytics_runs WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY at DESC LIMIT 1`;
    // Switched on before any fetch: no run yet, so tonight's is due.
    const lastAt = last[0]?.at;
    const lastDay =
      lastAt === undefined
        ? null
        : DateTime.formatIsoDate(DateTime.setZone(DateTime.makeUnsafe(lastAt), zone));
    if (lastDay !== today) yield* refresh(false);
  }).pipe(Effect.mapError(fail("nonPublic")));

  const setNightly = Effect.fn("PostAnalytics.setNightly")(
    function* (on: boolean) {
      yield* sql`
        INSERT OR REPLACE INTO post_analytics_nightly (account_id, enabled)
        VALUES (${sql.literal(CURRENT_ACCOUNT)}, ${on ? 1 : 0})
      `;
    },
    Effect.mapError(fail("nonPublic")),
  );

  return PostAnalytics.of({ refresh: refresh(true), current, setNightly, nightlyTick });
});

const layerService = Layer.effect(PostAnalytics, make);

// One fiber for the service's lifetime; a failing tick is logged and the next one still runs.
const layerLoop = Layer.effectDiscard(
  Effect.gen(function* () {
    const { nightlyTick } = yield* PostAnalytics;
    yield* nightlyTick.pipe(
      Effect.catch((e) => Effect.logWarning("PostAnalytics nightly tick failed", e)),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
);

export const layer = Layer.merge(layerService, layerLoop.pipe(Layer.provide(layerService)));

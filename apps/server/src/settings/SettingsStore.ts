import {
  type Settings,
  SettingsError,
  type SettingsUpdate,
  type SpendEntry,
  type SpendSummary,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const Keywords = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeKeywords = Schema.decodeUnknownSync(Keywords);
const encodeKeywords = Schema.encodeSync(Keywords);

interface SettingsRow {
  readonly handle: string | null;
  readonly treg_token: string | null;
  readonly monthly_budget_usd: number;
  readonly session_posting_enabled: number;
  readonly voice_notes: string;
  readonly keywords_json: string;
}

interface SpendRow {
  readonly at: string;
  readonly provider: SpendEntry["provider"];
  readonly endpoint: string;
  readonly purpose: string;
  readonly cost_usd: number;
}

export class SettingsStore extends Context.Service<
  SettingsStore,
  {
    readonly get: Effect.Effect<Settings, SettingsError>;
    /** The stored treg token, if the user pasted one. Never leaves the service. */
    readonly tregToken: Effect.Effect<string | null, SettingsError>;
    readonly update: (patch: SettingsUpdate) => Effect.Effect<Settings, SettingsError>;
    readonly recordSpend: (entry: Omit<SpendEntry, "at">) => Effect.Effect<void, SettingsError>;
    readonly spendSummary: Effect.Effect<SpendSummary, SettingsError>;
    /** True when this month's spend plus `costUsd` would pass the budget. */
    readonly wouldExceedBudget: (costUsd: number) => Effect.Effect<boolean, SettingsError>;
  }
>()("xtend/settings/SettingsStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const row = sql<SettingsRow>`SELECT * FROM settings WHERE id = 1`.pipe(
    Effect.map((rows) => rows[0]!),
  );

  const toSettings = (r: SettingsRow): Settings => ({
    handle: r.handle,
    tregTokenSet: r.treg_token !== null,
    monthlyBudgetUsd: r.monthly_budget_usd,
    sessionPostingEnabled: r.session_posting_enabled === 1,
    voiceNotes: r.voice_notes,
    keywords: decodeKeywords(r.keywords_json),
  });

  const get = row.pipe(
    Effect.map(toSettings),
    Effect.mapError((cause) => new SettingsError({ operation: "get", cause })),
  );

  const tregToken = row.pipe(
    Effect.map((r) => r.treg_token),
    Effect.mapError((cause) => new SettingsError({ operation: "get", cause })),
  );

  const update = Effect.fn("SettingsStore.update")(
    function* (patch: SettingsUpdate) {
      const current = yield* row;
      const at = yield* now;
      yield* sql`
        UPDATE settings SET
          handle = ${patch.handle === undefined ? current.handle : patch.handle},
          treg_token = ${patch.tregToken === undefined ? current.treg_token : patch.tregToken},
          monthly_budget_usd = ${patch.monthlyBudgetUsd ?? current.monthly_budget_usd},
          session_posting_enabled = ${patch.sessionPostingEnabled === undefined ? current.session_posting_enabled : patch.sessionPostingEnabled ? 1 : 0},
          voice_notes = ${patch.voiceNotes ?? current.voice_notes},
          keywords_json = ${patch.keywords === undefined ? current.keywords_json : encodeKeywords(patch.keywords)},
          updated_at = ${at}
        WHERE id = 1
      `;
      return toSettings(yield* row);
    },
    Effect.mapError((cause) => new SettingsError({ operation: "update", cause })),
  );

  const recordSpend = Effect.fn("SettingsStore.recordSpend")(
    function* (entry: Omit<SpendEntry, "at">) {
      if (entry.costUsd <= 0) return;
      const at = yield* now;
      yield* sql`
        INSERT INTO spend_log (at, provider, endpoint, purpose, cost_usd)
        VALUES (${at}, ${entry.provider}, ${entry.endpoint}, ${entry.purpose}, ${entry.costUsd})
      `;
    },
    Effect.mapError((cause) => new SettingsError({ operation: "spend", cause })),
  );

  const monthStart = Effect.map(DateTime.now, (d) => DateTime.formatIso(d).slice(0, 7) + "-01");
  const dayStart = Effect.map(DateTime.now, (d) => DateTime.formatIso(d).slice(0, 10));

  const monthSpend = Effect.gen(function* () {
    const since = yield* monthStart;
    const rows = yield* sql<{ total: number | null }>`
      SELECT SUM(cost_usd) AS total FROM spend_log WHERE at >= ${since}
    `;
    return rows[0]?.total ?? 0;
  });

  const spendSummary = Effect.gen(function* () {
    const monthUsd = yield* monthSpend;
    const since = yield* monthStart;
    const today = yield* dayStart;
    const todayRows = yield* sql<{ total: number | null }>`
      SELECT SUM(cost_usd) AS total FROM spend_log WHERE at >= ${today}
    `;
    const byPurpose = yield* sql<{ purpose: string; cost_usd: number }>`
      SELECT purpose, SUM(cost_usd) AS cost_usd FROM spend_log WHERE at >= ${since}
      GROUP BY purpose ORDER BY cost_usd DESC
    `;
    const recent = yield* sql<SpendRow>`
      SELECT at, provider, endpoint, purpose, cost_usd FROM spend_log ORDER BY id DESC LIMIT 50
    `;
    const settings = yield* row;
    return {
      monthUsd,
      todayUsd: todayRows[0]?.total ?? 0,
      monthlyBudgetUsd: settings.monthly_budget_usd,
      byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, costUsd: r.cost_usd })),
      recent: recent.map((r) => ({
        at: r.at,
        provider: r.provider,
        endpoint: r.endpoint,
        purpose: r.purpose,
        costUsd: r.cost_usd,
      })),
    } satisfies SpendSummary;
  }).pipe(Effect.mapError((cause) => new SettingsError({ operation: "spend", cause })));

  const wouldExceedBudget = Effect.fn("SettingsStore.wouldExceedBudget")(
    function* (costUsd: number) {
      const settings = yield* row;
      return (yield* monthSpend) + costUsd > settings.monthly_budget_usd;
    },
    Effect.mapError((cause) => new SettingsError({ operation: "spend", cause })),
  );

  return SettingsStore.of({ get, tregToken, update, recordSpend, spendSummary, wouldExceedBudget });
});

export const layer = Layer.effect(SettingsStore, make);

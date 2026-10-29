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
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as TokenCipher from "./TokenCipher.ts";

/** The stored zone as a DateTime zone; falls back to the machine's zone if the id went stale. */
export const zoneOf = (timeZone: string): DateTime.TimeZone =>
  Option.getOrElse(DateTime.zoneMakeNamed(timeZone), DateTime.zoneMakeLocal);

const Keywords = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeKeywords = Schema.decodeUnknownSync(Keywords);
const encodeKeywords = Schema.encodeSync(Keywords);

interface SettingsRow {
  readonly handle: string | null;
  readonly treg_token: string | null;
  readonly monthly_budget_usd: number;
  readonly session_posting_enabled: number;
  readonly daily_library_jobs: number;
  readonly voice_notes: string;
  readonly keywords_json: string;
  readonly time_zone: string | null;
  readonly assist_provider: Settings["assistProvider"];
  readonly assist_base_url: string | null;
  readonly assist_model: string;
  readonly assist_key: string | null;
  readonly pool_sharing: number;
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
    /** The key for the user's own assist endpoint, if any. Never leaves the service. */
    readonly assistKey: Effect.Effect<string | null, SettingsError>;
    readonly update: (patch: SettingsUpdate) => Effect.Effect<Settings, SettingsError>;
    readonly recordSpend: (entry: Omit<SpendEntry, "at">) => Effect.Effect<void, SettingsError>;
    readonly spendSummary: Effect.Effect<SpendSummary, SettingsError>;
    /** True when this month's spend plus `costUsd` would pass the budget. */
    readonly wouldExceedBudget: (costUsd: number) => Effect.Effect<boolean, SettingsError>;
  }
>()("xtend/settings/SettingsStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const cipher = yield* TokenCipher.TokenCipher;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  // The service machine's zone until the user picks one; every conversion the service does uses this.
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const row = sql<SettingsRow>`SELECT * FROM settings WHERE id = 1`.pipe(
    Effect.map((rows) => rows[0]!),
  );

  const toSettings = (r: SettingsRow): Settings => ({
    handle: r.handle,
    tregTokenSet: r.treg_token !== null,
    monthlyBudgetUsd: r.monthly_budget_usd,
    sessionPostingEnabled: r.session_posting_enabled === 1,
    dailyLibraryJobs: r.daily_library_jobs === 1,
    voiceNotes: r.voice_notes,
    keywords: decodeKeywords(r.keywords_json),
    timeZone: r.time_zone ?? defaultZone,
    assistProvider: r.assist_provider,
    assistBaseUrl: r.assist_base_url,
    assistModel: r.assist_model,
    assistKeySet: r.assist_key !== null,
    poolSharing: r.pool_sharing === 1,
  });

  const get = row.pipe(
    Effect.map(toSettings),
    Effect.mapError((cause) => new SettingsError({ operation: "get", cause })),
  );

  // A token sealed with another secret-key (a database copied without its base dir) fails
  // here as a SettingsError, so callers fall back to the CLI login instead of dying.
  const secret = (pick: (r: SettingsRow) => string | null) =>
    row.pipe(
      Effect.flatMap((r) => {
        const stored = pick(r);
        return stored === null ? Effect.succeed(null) : Effect.try(() => cipher.decrypt(stored));
      }),
      Effect.mapError((cause) => new SettingsError({ operation: "get", cause })),
    );
  const tregToken = secret((r) => r.treg_token);
  const assistKey = secret((r) => r.assist_key);

  const update = Effect.fn("SettingsStore.update")(
    function* (patch: SettingsUpdate) {
      const current = yield* row;
      const at = yield* now;
      const handle = patch.handle === undefined ? current.handle : patch.handle;
      // A pasted token often carries a stray space or newline, which would make every treg call 401.
      const pasted = typeof patch.tregToken === "string" ? patch.tregToken.trim() : patch.tregToken;
      const token =
        pasted === undefined ? current.treg_token : pasted ? cipher.encrypt(pasted) : null;
      const assistBaseUrl =
        patch.assistBaseUrl === undefined
          ? current.assist_base_url
          : (patch.assistBaseUrl?.trim().replace(/\/+$/, "") ?? null) || null;
      const pastedKey =
        typeof patch.assistKey === "string" ? patch.assistKey.trim() : patch.assistKey;
      // A key belongs to the endpoint it was pasted for: a new endpoint without a new key drops it,
      // so a changed URL can never receive the old provider's secret.
      const assistKey =
        pastedKey === undefined
          ? assistBaseUrl === current.assist_base_url
            ? current.assist_key
            : null
          : pastedKey
            ? cipher.encrypt(pastedKey)
            : null;
      if (patch.timeZone !== undefined && DateTime.zoneMakeNamed(patch.timeZone)._tag === "None")
        return yield* Effect.fail(`unknown time zone ${patch.timeZone}`);
      yield* sql`
        UPDATE settings SET
          handle = ${handle === null ? null : handle.toLowerCase()},
          treg_token = ${token},
          monthly_budget_usd = ${patch.monthlyBudgetUsd ?? current.monthly_budget_usd},
          session_posting_enabled = ${patch.sessionPostingEnabled === undefined ? current.session_posting_enabled : patch.sessionPostingEnabled ? 1 : 0},
          daily_library_jobs = ${patch.dailyLibraryJobs === undefined ? current.daily_library_jobs : patch.dailyLibraryJobs ? 1 : 0},
          voice_notes = ${patch.voiceNotes ?? current.voice_notes},
          keywords_json = ${patch.keywords === undefined ? current.keywords_json : encodeKeywords(patch.keywords)},
          time_zone = ${patch.timeZone ?? current.time_zone},
          assist_provider = ${patch.assistProvider ?? current.assist_provider},
          assist_base_url = ${assistBaseUrl},
          assist_model = ${patch.assistModel?.trim() ?? current.assist_model},
          assist_key = ${assistKey},
          pool_sharing = ${patch.poolSharing === undefined ? current.pool_sharing : patch.poolSharing ? 1 : 0},
          updated_at = ${at}
        WHERE id = 1
      `;
      // The handle is also the current account's handle; the switcher shows the same value.
      if (patch.handle !== undefined)
        yield* sql`
          UPDATE accounts SET handle = ${handle === null ? null : handle.toLowerCase()}
          WHERE id = ${sql.literal(CURRENT_ACCOUNT)}
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

  // Today and this month are the user's, in settings.timeZone, not UTC's. spend_log holds UTC
  // ISO instants, so the start instant compares with them as text.
  const startOf = (r: SettingsRow, part: "day" | "month") =>
    Effect.map(DateTime.now, (d) =>
      DateTime.formatIso(
        DateTime.startOf(DateTime.setZone(d, zoneOf(r.time_zone ?? defaultZone)), part),
      ),
    );

  const monthSpend = (r: SettingsRow) =>
    Effect.gen(function* () {
      const since = yield* startOf(r, "month");
      const rows = yield* sql<{ total: number | null }>`
        SELECT SUM(cost_usd) AS total FROM spend_log WHERE at >= ${since}
      `;
      return rows[0]?.total ?? 0;
    });

  const spendSummary = Effect.gen(function* () {
    const settings = yield* row;
    const monthUsd = yield* monthSpend(settings);
    const since = yield* startOf(settings, "month");
    const today = yield* startOf(settings, "day");
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
      return (yield* monthSpend(settings)) + costUsd > settings.monthly_budget_usd;
    },
    Effect.mapError((cause) => new SettingsError({ operation: "spend", cause })),
  );

  return SettingsStore.of({
    get,
    tregToken,
    assistKey,
    update,
    recordSpend,
    spendSummary,
    wouldExceedBudget,
  });
});

export const layer = Layer.effect(SettingsStore, make);

import { type XSettingChange, XSettingsError, type XSettingValue } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";

/** The log a rail shows: enough to cover weeks of flips without growing for good. */
const KEEP = 100;

interface ChangeRow {
  readonly key: string;
  readonly page: string;
  readonly label: string;
  readonly from_value: string;
  readonly to_value: string;
  readonly in_xtend: number;
  readonly at: string;
}

const toChange = (r: ChangeRow): XSettingChange => ({
  key: r.key,
  page: r.page,
  label: r.label,
  from: r.from_value,
  to: r.to_value,
  at: r.at,
  inXtend: r.in_xtend === 1,
});

export class XSettingsLog extends Context.Service<
  XSettingsLog,
  {
    /**
     * Files what account `accountId`'s X page drew: a value that differs from the last one seen
     * is a change, the user's own when its key is in `pressed`. A key seen for the first time is
     * no change, and an account that no longer exists files nothing.
     */
    readonly seen: (
      accountId: number,
      values: ReadonlyArray<XSettingValue>,
      pressed: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<XSettingChange>, XSettingsError>;
    /** The current account's changes, newest first. */
    readonly changes: Effect.Effect<ReadonlyArray<XSettingChange>, XSettingsError>;
  }
>()("xtend/xsettings/XSettingsLog") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const current = sql.literal(CURRENT_ACCOUNT);

  const seen = Effect.fn("XSettingsLog.seen")(
    function* (
      accountId: number,
      values: ReadonlyArray<XSettingValue>,
      pressed: ReadonlyArray<string>,
    ) {
      const at = DateTime.formatIso(yield* DateTime.now);
      const logged: Array<XSettingChange> = [];
      const [owner] = yield* sql<{ id: number }>`SELECT id FROM accounts WHERE id = ${accountId}`;
      if (owner === undefined) return logged;
      const account = owner.id;
      for (const v of values) {
        const [last] = yield* sql<{ value: string }>`
          SELECT value FROM x_settings_seen WHERE account_id = ${account} AND key = ${v.key}
        `;
        yield* sql`
          INSERT INTO x_settings_seen (account_id, key, value, seen_at)
          VALUES (${account}, ${v.key}, ${v.value}, ${at})
          ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value, seen_at = excluded.seen_at
        `;
        if (last === undefined || last.value === v.value) continue;
        const change = {
          key: v.key,
          page: v.page,
          label: v.label,
          from: last.value,
          to: v.value,
          at,
          inXtend: pressed.includes(v.key),
        };
        yield* sql`
          INSERT INTO x_settings_changes (account_id, key, page, label, from_value, to_value, in_xtend, at)
          VALUES (${account}, ${v.key}, ${v.page}, ${v.label}, ${change.from}, ${change.to}, ${change.inXtend ? 1 : 0}, ${at})
        `;
        logged.push(change);
      }
      if (logged.length > 0)
        yield* sql`
          DELETE FROM x_settings_changes WHERE account_id = ${account} AND id NOT IN (
            SELECT id FROM x_settings_changes WHERE account_id = ${account} ORDER BY id DESC LIMIT ${KEEP}
          )
        `;
      return logged;
    },
    sql.withTransaction,
    Effect.mapError((cause) => new XSettingsError({ operation: "seen", cause })),
  );

  const changes = sql<ChangeRow>`
    SELECT key, page, label, from_value, to_value, in_xtend, at FROM x_settings_changes
    WHERE account_id = ${current} ORDER BY id DESC
  `.pipe(
    Effect.map((rows) => rows.map(toChange)),
    Effect.mapError((cause) => new XSettingsError({ operation: "changes", cause })),
    Effect.withSpan("XSettingsLog.changes"),
  );

  return XSettingsLog.of({ seen, changes });
});

export const layer = Layer.effect(XSettingsLog, make);

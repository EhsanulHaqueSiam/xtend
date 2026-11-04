import { describe, expect, it } from "@effect/vitest";
import type { XSettingValue } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as XSettingsLog from "./XSettingsLog.ts";

const layerTest = XSettingsLog.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const value = (label: string, v: string): XSettingValue => ({
  key: `/settings/audience_and_tagging ${label}`,
  page: "Audience, media and tagging",
  label,
  value: v,
});
const switchAccount = (id: number) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`,
  );

describe("XSettingsLog", () => {
  it.effect(
    "logs a value only when it differs from the last one seen, as the user's when they pressed it, per account",
    () =>
      Effect.gen(function* () {
        const log = yield* XSettingsLog.XSettingsLog;
        // First seen: nothing to compare with, so no change.
        expect(yield* log.seen([value("Protect your posts", "Off")], null)).toEqual([]);
        expect(yield* log.seen([value("Protect your posts", "Off")], null)).toEqual([]);
        // Flipped on the phone: X's page shows it changed, not from Xtend.
        const [phone] = yield* log.seen([value("Protect your posts", "On")], null);
        expect(phone).toMatchObject({ from: "Off", to: "On", inXtend: false });
        // Pressed in Xtend.
        yield* log.seen(
          [value("Protect your posts", "Off")],
          "/settings/audience_and_tagging Protect your posts",
        );
        expect((yield* log.changes).map((c) => `${c.from}>${c.to} ${c.inXtend}`)).toEqual([
          "On>Off true",
          "Off>On false",
        ]);

        // Another account has its own values and log.
        yield* switchAccount(2);
        expect(yield* log.changes).toEqual([]);
        expect(yield* log.seen([value("Protect your posts", "On")], null)).toEqual([]);
        yield* switchAccount(1);
        expect(yield* log.changes).toHaveLength(2);
      }).pipe(Effect.provide(layerTest)),
  );
});

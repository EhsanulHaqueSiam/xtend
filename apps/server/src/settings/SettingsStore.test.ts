import { describe, expect, it } from "@effect/vitest";
import { SettingsUpdate } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "./SettingsStore.ts";
import * as TokenCipher from "./TokenCipher.ts";

const layerTest = SettingsStore.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

describe("SettingsStore", () => {
  it.effect(
    "lowercases the handle, defaults the zone and keeps the treg token encrypted at rest",
    () =>
      Effect.gen(function* () {
        const store = yield* SettingsStore.SettingsStore;
        const sql = yield* SqlClient.SqlClient;
        const initial = yield* store.get;
        expect(initial.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        const updated = yield* store.update({
          handle: "EhsanulHaqueSiam",
          tregToken: "trg_secret",
        });
        expect(updated.handle).toBe("ehsanulhaquesiam");
        expect(updated.tregTokenSet).toBe(true);
        const rows = yield* sql<{ treg_token: string }>`SELECT treg_token FROM settings`;
        expect(rows[0]?.treg_token).not.toContain("trg_secret");
        expect(yield* store.tregToken).toBe("trg_secret");
      }).pipe(Effect.provide(layerTest)),
  );

  it("rejects a negative or non-finite budget at the contract", () => {
    const decode = Schema.decodeUnknownResult(SettingsUpdate);
    expect(decode({ monthlyBudgetUsd: -1 })._tag).toBe("Failure");
    expect(decode({ monthlyBudgetUsd: Number.NaN })._tag).toBe("Failure");
    expect(decode({ monthlyBudgetUsd: 25 })._tag).toBe("Success");
  });
});

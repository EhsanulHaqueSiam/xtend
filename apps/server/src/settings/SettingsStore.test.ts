import { describe, expect, it } from "@effect/vitest";
import { SettingsUpdate } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

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

  it.effect("counts today and this month, budget included, in the user's zone", () =>
    Effect.gen(function* () {
      const store = yield* SettingsStore.SettingsStore;
      yield* store.update({ timeZone: "Australia/Sydney", monthlyBudgetUsd: 0.15 });
      const spendAt = (iso: string, costUsd: number) =>
        Effect.andThen(
          TestClock.setTime(Date.parse(iso)),
          store.recordSpend({ provider: "treg", endpoint: "e", purpose: "test", costUsd }),
        );
      // Oct 31 21:00 and Nov 1 01:00 in Sydney; both still Oct 31 in UTC.
      yield* spendAt("2026-10-31T10:00:00.000Z", 0.1);
      yield* spendAt("2026-10-31T14:00:00.000Z", 0.05);
      yield* TestClock.setTime(Date.parse("2026-10-31T20:00:00.000Z"));

      const summary = yield* store.spendSummary;
      expect(summary.monthUsd).toBeCloseTo(0.05);
      expect(summary.todayUsd).toBeCloseTo(0.05);
      expect(yield* store.wouldExceedBudget(0.05)).toBe(false);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("stores a pasted token without its stray whitespace, and a blank one clears it", () =>
    Effect.gen(function* () {
      const store = yield* SettingsStore.SettingsStore;
      yield* store.update({ tregToken: "  trg_secret\n" });
      expect(yield* store.tregToken).toBe("trg_secret");
      expect((yield* store.update({ tregToken: " " })).tregTokenSet).toBe(false);
      expect(yield* store.tregToken).toBe(null);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "fails with a SettingsError, not a defect, when the stored token cannot be opened",
    () =>
      Effect.gen(function* () {
        const store = yield* SettingsStore.SettingsStore;
        yield* store.update({ tregToken: "trg_secret" });
        // The same database read with another secret-key, as after copying it without the base dir.
        const otherKey = Layer.succeed(TokenCipher.TokenCipher)({
          encrypt: (plain) => plain,
          decrypt: () => {
            throw new Error("Unsupported state or unable to authenticate data");
          },
        });
        const other = yield* SettingsStore.SettingsStore.pipe(
          Effect.provide(Layer.fresh(SettingsStore.layer).pipe(Layer.provide(otherKey))),
        );
        const error = yield* Effect.flip(other.tregToken);
        expect(error._tag).toBe("SettingsError");
      }).pipe(Effect.provide(layerTest)),
  );

  it("rejects a negative or non-finite budget at the contract", () => {
    const decode = Schema.decodeUnknownResult(SettingsUpdate);
    expect(decode({ monthlyBudgetUsd: -1 })._tag).toBe("Failure");
    expect(decode({ monthlyBudgetUsd: Number.NaN })._tag).toBe("Failure");
    expect(decode({ monthlyBudgetUsd: 25 })._tag).toBe("Success");
  });
});

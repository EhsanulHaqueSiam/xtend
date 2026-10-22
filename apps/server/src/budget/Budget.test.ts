import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Budget from "./Budget.ts";

const layerTest = Budget.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

const request = { expectedUsd: 0.01, provider: "treg" as const, endpoint: "t", purpose: "test" };

describe("Budget", () => {
  // it.live: the bodies sleep on the real clock so every reservation is decided before any settles.
  it.live("lets exactly as many concurrent callers through as the budget covers", () =>
    Effect.gen(function* () {
      const budget = yield* Budget.Budget;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ monthlyBudgetUsd: 0.03 });
      // Every body sleeps, so all ten reservations are decided before any settles.
      const body = Effect.sleep("20 millis").pipe(Effect.as({ value: "ok", costUsd: 0.01 }));
      const results = yield* Effect.all(
        Array.from({ length: 10 }, () => Effect.result(budget.spend(request, body))),
        { concurrency: "unbounded" },
      );
      const ok = results.filter((r) => r._tag === "Success").length;
      const refused = results.filter(
        (r) => r._tag === "Failure" && r.failure._tag === "BudgetExceeded",
      ).length;
      expect(ok).toBe(3);
      expect(refused).toBe(7);
      expect((yield* settings.spendSummary).monthUsd).toBeCloseTo(0.03);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("settles the actual charge and frees the reservation when the body fails", () =>
    Effect.gen(function* () {
      const budget = yield* Budget.Budget;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ monthlyBudgetUsd: 0.015 });
      const cheaper = budget.spend(request, Effect.succeed({ value: 1, costUsd: 0.004 }));
      expect(yield* cheaper).toBe(1);
      const failing = budget.spend(request, Effect.fail("provider down"));
      expect((yield* Effect.result(failing))._tag).toBe("Failure");
      // 0.004 spent, nothing reserved: another 0.01 still fits under 0.015.
      expect(yield* cheaper).toBe(1);
      expect((yield* settings.spendSummary).monthUsd).toBeCloseTo(0.008);
    }).pipe(Effect.provide(layerTest)),
  );
});

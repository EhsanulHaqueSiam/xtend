import { describe, expect, it } from "@effect/vitest";
import { SettingsError } from "@xtend/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Budget from "./Budget.ts";

const layerTest = Budget.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

// The real store, except the budget check fails as a locked or unreadable database would.
const layerUnreadable = Budget.layer.pipe(
  Layer.provide(
    Layer.effect(
      SettingsStore.SettingsStore,
      Effect.gen(function* () {
        const settings = yield* SettingsStore.SettingsStore;
        return SettingsStore.SettingsStore.of({
          ...settings,
          wouldExceedBudget: () =>
            Effect.fail(new SettingsError({ operation: "spend", cause: "database is locked" })),
        });
      }),
    ).pipe(Layer.provide(SettingsStore.layer)),
  ),
  Layer.provide(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

const request = { expectedUsd: 0.01, provider: "treg" as const, endpoint: "t", purpose: "test" };

describe("Budget", () => {
  it.effect("lets exactly as many concurrent callers through as the budget covers", () =>
    Effect.gen(function* () {
      const budget = yield* Budget.Budget;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ monthlyBudgetUsd: 0.03 });
      // The bodies hold until the budget's three are in, so no reservation settles before the
      // other seven are decided.
      const allIn = yield* Deferred.make<void>();
      const started = yield* Ref.make(0);
      const body = Ref.updateAndGet(started, (n) => n + 1).pipe(
        Effect.tap((n) => (n === 3 ? Deferred.succeed(allIn, undefined) : Effect.void)),
        Effect.andThen(Deferred.await(allIn)),
        Effect.as({ value: "ok", costUsd: 0.01 }),
      );
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

  it.effect("charges the quote for a call its caller abandoned mid-flight, and frees it", () =>
    Effect.gen(function* () {
      const budget = yield* Budget.Budget;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ monthlyBudgetUsd: 0.025 });
      const started = yield* Deferred.make<void>();
      const inFlight = yield* Effect.forkChild(
        budget.spend(request, Effect.andThen(Deferred.succeed(started, undefined), Effect.never)),
      );
      yield* Deferred.await(started);
      yield* Fiber.interrupt(inFlight);
      // The provider may have served it before the caller left.
      expect((yield* settings.spendSummary).monthUsd).toBeCloseTo(0.01);
      // Had it stayed reserved, this 0.01 would pass the 0.025 budget.
      expect(yield* budget.spend(request, Effect.succeed({ value: 1, costUsd: 0.01 }))).toBe(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a paid call when the budget cannot be read, without running it", () =>
    Effect.gen(function* () {
      const budget = yield* Budget.Budget;
      let ran = false;
      const body = Effect.sync(() => {
        ran = true;
        return { value: 1, costUsd: 0.01 };
      });
      expect((yield* Effect.flip(budget.spend(request, body)))._tag).toBe("BudgetExceeded");
      expect(ran).toBe(false);
    }).pipe(Effect.provide(layerUnreadable)),
  );
});

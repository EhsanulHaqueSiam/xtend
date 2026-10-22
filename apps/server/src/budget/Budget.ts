import type { SpendEntry } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as Events from "../events/Events.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

export class BudgetExceeded extends Schema.TaggedError<BudgetExceeded>()("BudgetExceeded", {
  expectedUsd: Schema.Number,
  purpose: Schema.String,
}) {
  override get message(): string {
    return "monthly budget reached; raise it in Settings";
  }
}

export interface SpendRequest {
  /** Quoted price, reserved before the call runs. */
  readonly expectedUsd: number;
  readonly provider: SpendEntry["provider"];
  readonly endpoint: string;
  readonly purpose: string;
}

/**
 * The one budget gate. A paid call reserves its quoted price under a
 * semaphore, so concurrent callers see each other's reservations, then
 * settles what the provider actually charged. Treg and Assist both go
 * through here; nothing else records spend.
 */
export class Budget extends Context.Service<
  Budget,
  {
    readonly spend: <A, E, R>(
      request: SpendRequest,
      body: Effect.Effect<{ readonly value: A; readonly costUsd: number }, E, R>,
    ) => Effect.Effect<A, E | BudgetExceeded, R>;
  }
>()("xtend/budget/Budget") {}

const make = Effect.gen(function* () {
  const settings = yield* SettingsStore.SettingsStore;
  const events = yield* Events.Events;
  const gate = yield* Semaphore.make(1);
  // Reservations in flight. One process owns the budget, so memory is the ledger.
  let reserved = 0;

  const reserve = (request: SpendRequest) =>
    Semaphore.withPermits(
      gate,
      1,
    )(
      Effect.gen(function* () {
        // A settings failure must not unlock spending: treat it as over budget.
        const over = yield* settings
          .wouldExceedBudget(reserved + request.expectedUsd)
          .pipe(Effect.orElseSucceed(() => true));
        if (request.expectedUsd > 0 && over)
          return yield* new BudgetExceeded({
            expectedUsd: request.expectedUsd,
            purpose: request.purpose,
          });
        reserved += request.expectedUsd;
      }),
    );

  const settle = (request: SpendRequest, costUsd: number) =>
    Semaphore.withPermits(
      gate,
      1,
    )(
      Effect.gen(function* () {
        reserved -= request.expectedUsd;
        yield* settings
          .recordSpend({
            provider: request.provider,
            endpoint: request.endpoint,
            purpose: request.purpose,
            costUsd,
          })
          .pipe(Effect.ignore);
        if (costUsd > 0)
          yield* events.publish({
            type: "spend_changed",
            payload: { costUsd, purpose: request.purpose },
          });
      }),
    );

  const spend = <A, E, R>(
    request: SpendRequest,
    body: Effect.Effect<{ readonly value: A; readonly costUsd: number }, E, R>,
  ): Effect.Effect<A, E | BudgetExceeded, R> =>
    Effect.acquireUseRelease(
      Effect.map(reserve(request), () => ({ charged: 0 })),
      (slot) =>
        Effect.map(body, (r) => {
          slot.charged = r.costUsd;
          return r.value;
        }),
      // A failed body may still have cost something (HTTP 4xx from X is billed); the slot carries it.
      (slot) => settle(request, slot.charged),
    );

  return Budget.of({ spend });
});

// Events is memoized by reference, so every layer that provides it shares one hub.
export const layer = Layer.effect(Budget, make).pipe(Layer.provide(Events.layer));

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { layerDaily } from "./DailyJobs.ts";

const layerTest = SettingsStore.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

it.effect("runs a job once per local day at or after its time, across restarts and failures", () =>
  Effect.gen(function* () {
    const settings = yield* SettingsStore.SettingsStore;
    yield* settings.update({ timeZone: "America/Los_Angeles" });
    let runs = 0;
    const jobs = layerDaily([
      {
        name: "test.paid",
        at: "08:00",
        // A failing paid job must not retry every minute.
        run: Effect.suspend(() => {
          runs++;
          return Effect.fail("treg is down");
        }),
      },
    ]);
    // One service lifetime on the shared database: start, let the clock run, stop.
    const serviceUp = (minutes: number) =>
      Effect.scoped(Effect.andThen(Layer.build(jobs), TestClock.adjust(`${minutes} minutes`)));

    // 07:00 on Oct 22 in Los Angeles.
    yield* TestClock.setTime(Date.parse("2026-10-22T14:00:00.000Z"));
    yield* serviceUp(59);
    expect(runs).toBe(0);
    yield* serviceUp(5);
    expect(runs).toBe(1);
    // A restart later the same day does not run it again.
    yield* serviceUp(120);
    expect(runs).toBe(1);
    // Through 17:00, UTC midnight, and local midnight up to 01:04 on Oct 23: still once.
    yield* serviceUp(15 * 60);
    expect(runs).toBe(1);
    // 08:04 on Oct 23.
    yield* serviceUp(7 * 60);
    expect(runs).toBe(2);
  }).pipe(Effect.provide(layerTest)),
);

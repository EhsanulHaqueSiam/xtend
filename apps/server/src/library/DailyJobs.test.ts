import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { layerDaily } from "./DailyJobs.ts";

const layerBase = SettingsStore.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

it.effect("skips a job that is not turned on without claiming its day", () =>
  Effect.gen(function* () {
    const on = yield* Ref.make(false);
    const runs = yield* Ref.make(0);
    const job = {
      name: "test.job",
      at: "00:00",
      enabled: Ref.get(on),
      run: Ref.update(runs, (n) => n + 1),
    };
    yield* Layer.build(layerDaily([job]));
    yield* TestClock.adjust("1 second");
    expect(yield* Ref.get(runs)).toBe(0);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT job FROM jobs_ran`).toEqual([]);

    // Turned on later the same day, it still runs today, once.
    yield* Ref.set(on, true);
    yield* TestClock.adjust("61 seconds");
    yield* TestClock.adjust("61 seconds");
    expect(yield* Ref.get(runs)).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(layerBase)),
);

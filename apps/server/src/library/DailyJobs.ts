import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import * as SettingsStore from "../settings/SettingsStore.ts";

export interface DailyJob<E, R> {
  readonly name: string;
  /** Local wall-clock time in the account's time zone, "HH:MM". */
  readonly at: string;
  readonly run: Effect.Effect<unknown, E, R>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Runs each job once per local day, the first minute at or after its time.
 * A job is marked as ran before it starts, so a failing paid job does not
 * retry every minute until midnight.
 */
export const layerDaily = <E, R>(jobs: ReadonlyArray<DailyJob<E, R>>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const settings = yield* SettingsStore.SettingsStore;
      const tick = Effect.gen(function* () {
        const { timeZone } = yield* settings.get;
        const p = DateTime.toParts(
          DateTime.setZone(yield* DateTime.now, SettingsStore.zoneOf(timeZone)),
        );
        const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
        const hhmm = `${pad(p.hour)}:${pad(p.minute)}`;
        for (const job of jobs) {
          if (hhmm < job.at) continue;
          const claimed = yield* sql<{ job: string }>`
            INSERT OR IGNORE INTO jobs_ran (job, day) VALUES (${job.name}, ${day}) RETURNING job
          `;
          if (claimed.length === 0) continue;
          yield* job.run.pipe(
            Effect.catchCause((cause) => Effect.logWarning(`daily job ${job.name} failed`, cause)),
          );
        }
      });
      yield* tick.pipe(
        Effect.catchCause((cause) => Effect.logWarning("daily jobs tick failed", cause)),
        Effect.repeat(Schedule.spaced("60 seconds")),
        Effect.forkScoped,
      );
    }),
  );

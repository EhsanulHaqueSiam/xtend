import { ComposeError, type Slot, type SlotInput } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

interface SlotRow {
  readonly id: number;
  readonly weekday_mask: number;
  readonly minute_of_day: number;
}

const toSlot = (r: SlotRow): Slot => ({
  id: r.id,
  weekdayMask: r.weekday_mask,
  minuteOfDay: r.minute_of_day,
});

/** Slot times in the account's zone for the 60 days after `after`, ascending UTC. */
export const slotTimesAfter = (
  slots: ReadonlyArray<SlotInput>,
  after: DateTime.Utc,
  zone: DateTime.TimeZone,
): Array<string> => {
  const out: Array<string> = [];
  const afterMillis = DateTime.toEpochMillis(after);
  let day = DateTime.setZone(after, zone).pipe(DateTime.startOf("day"));
  for (let d = 0; d < 60; d++) {
    const weekday = DateTime.toParts(day).weekDay;
    for (const slot of slots) {
      if ((slot.weekdayMask & (1 << weekday)) === 0) continue;
      const at = DateTime.setParts(day, {
        hour: Math.floor(slot.minuteOfDay / 60),
        minute: slot.minuteOfDay % 60,
      });
      if (DateTime.toEpochMillis(at) > afterMillis)
        out.push(DateTime.formatIso(DateTime.toUtc(at)));
    }
    day = DateTime.add(day, { days: 1 });
  }
  return out.sort();
};

export class SlotStore extends Context.Service<
  SlotStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Slot>, ComposeError>;
    readonly replace: (
      slots: ReadonlyArray<SlotInput>,
    ) => Effect.Effect<ReadonlyArray<Slot>, ComposeError>;
    /** First slot after `after` that no queued draft holds; null when there are no slots. */
    readonly nextFree: (after: DateTime.Utc) => Effect.Effect<string | null, ComposeError>;
  }
>()("xtend/compose/SlotStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* SettingsStore.SettingsStore;
  const fail = (operation: string) => (cause: unknown) =>
    new ComposeError({ operation, detail: String(cause).slice(0, 300) });
  const zone = Effect.map(settings.get, (s) => SettingsStore.zoneOf(s.timeZone));

  const list =
    sql<SlotRow>`SELECT * FROM slots WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY minute_of_day ASC`.pipe(
      Effect.map((rows) => rows.map(toSlot)),
      Effect.mapError(fail("slots")),
    );

  const replace = Effect.fn("SlotStore.replace")(
    function* (slots: ReadonlyArray<SlotInput>) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM slots WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
          for (const s of slots)
            yield* sql`INSERT INTO slots (weekday_mask, minute_of_day) VALUES (${s.weekdayMask}, ${s.minuteOfDay})`;
        }),
      );
      return yield* list;
    },
    Effect.mapError(fail("slotsSet")),
  );

  const nextFree = Effect.fn("SlotStore.nextFree")(
    function* (after: DateTime.Utc) {
      const slots = yield* list;
      const taken = yield* sql<{ scheduled_at: string }>`
        SELECT scheduled_at FROM drafts WHERE status = 'queued' AND scheduled_at IS NOT NULL AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
      `;
      const held = new Set(taken.map((r) => r.scheduled_at));
      return slotTimesAfter(slots, after, yield* zone).find((t) => !held.has(t)) ?? null;
    },
    Effect.mapError(fail("nextFree")),
  );

  return SlotStore.of({ list, replace, nextFree });
});

export const layer = Layer.effect(SlotStore, make);

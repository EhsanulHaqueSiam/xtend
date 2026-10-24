import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as SlotStore from "./SlotStore.ts";

const layerTest = SlotStore.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

describe("SlotStore", () => {
  it("expresses a 09:00 slot in the account's zone, not the machine's", () => {
    const after = DateTime.makeUnsafe("2026-10-22T00:00:00.000Z");
    const slots = [{ weekdayMask: 127, minuteOfDay: 540 }];
    const dhaka = SlotStore.slotTimesAfter(slots, after, SettingsStore.zoneOf("Asia/Dhaka"));
    const utc = SlotStore.slotTimesAfter(slots, after, SettingsStore.zoneOf("UTC"));
    expect(dhaka[0]).toBe("2026-10-22T03:00:00.000Z");
    expect(utc[0]).toBe("2026-10-22T09:00:00.000Z");
  });

  it("keeps a slot at its wall time across a daylight saving change", () => {
    const ny = SettingsStore.zoneOf("America/New_York");
    const after = DateTime.makeUnsafe("2026-10-31T00:00:00.000Z");
    // New York falls back on 1 November 2026: 09:00 is 13:00 UTC before, 14:00 UTC after.
    const times = SlotStore.slotTimesAfter([{ weekdayMask: 127, minuteOfDay: 540 }], after, ny);
    expect(times.slice(0, 2)).toEqual(["2026-10-31T13:00:00.000Z", "2026-11-01T14:00:00.000Z"]);
  });

  it("reads the weekday in the account's zone, where midnight is not UTC's", () => {
    // Saturday 20:00 UTC is already Sunday 02:00 in Dhaka, past that Sunday's 00:30 slot.
    const after = DateTime.makeUnsafe("2026-10-24T20:00:00.000Z");
    const sundays = SlotStore.slotTimesAfter(
      [{ weekdayMask: 1, minuteOfDay: 30 }],
      after,
      SettingsStore.zoneOf("Asia/Dhaka"),
    );
    expect(sundays.slice(0, 2)).toEqual(["2026-10-31T18:30:00.000Z", "2026-11-07T18:30:00.000Z"]);
  });

  it.effect("next free slot follows the zone in Settings and replace is all or nothing", () =>
    Effect.gen(function* () {
      const settings = yield* SettingsStore.SettingsStore;
      const slots = yield* SlotStore.SlotStore;
      yield* settings.update({ timeZone: "Asia/Dhaka" });
      yield* slots.replace([{ weekdayMask: 127, minuteOfDay: 540 }]);
      const next = yield* slots.nextFree(DateTime.makeUnsafe("2026-10-22T00:00:00.000Z"));
      expect(next).toBe("2026-10-22T03:00:00.000Z");
      expect((yield* Effect.result(settings.update({ timeZone: "Mars/Olympus" })))._tag).toBe(
        "Failure",
      );
    }).pipe(Effect.provide(layerTest)),
  );
});

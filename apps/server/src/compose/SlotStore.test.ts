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

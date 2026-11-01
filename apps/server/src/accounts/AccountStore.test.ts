import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as DraftStore from "../compose/DraftStore.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as AccountStore from "./AccountStore.ts";

const layerTest = Layer.mergeAll(AccountStore.layer, SettingsStore.layer, DraftStore.layer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(Sqlite.layerMemory, NodeCrypto.layer, TokenCipher.layerTest, Events.layer),
  ),
);

describe("AccountStore", () => {
  it.effect("switching accounts points every handle-scoped screen at the new handle", () =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore.AccountStore;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ handle: "siam" });
      const created = yield* accounts.create({ handle: "Naval", label: "Client" });
      const naval = created.accounts.find((a) => a.label === "Client")!;
      expect([naval.handle, created.currentId]).toEqual(["naval", 1]);

      const switched = yield* accounts.select(naval.id);
      expect(switched.currentId).toBe(naval.id);
      expect((yield* settings.get).handle).toBe("naval");
      // Setting the handle in Settings renames the current account, not the first one.
      yield* settings.update({ handle: "navalr" });
      expect((yield* accounts.list).accounts.map((a) => a.handle)).toEqual(["siam", "navalr"]);

      yield* accounts.select(1);
      expect((yield* settings.get).handle).toBe("siam");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "refuses to switch while a thread of this account is posting, and tells every client once it does",
    () =>
      Effect.gen(function* () {
        const accounts = yield* AccountStore.AccountStore;
        const drafts = yield* DraftStore.DraftStore;
        const events = yield* Events.Events;
        const switches = yield* events.stream.pipe(
          Stream.filter((e) => e.type === "account_switched"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* accounts.create({ handle: "naval", label: "Client" });
        const thread = yield* drafts.create({ blocks: [{ text: "1/2" }, { text: "2/2" }] });
        expect(yield* drafts.claim(thread.id)).toBe(true);

        // Its media posts would go out through the other account's x.com session.
        const refused = yield* Effect.flip(accounts.select(2));
        expect(refused.message).toContain("still going out on this account");
        expect((yield* accounts.list).currentId).toBe(1);
        // Picking the account already current is no switch, so nothing to refuse or announce.
        expect((yield* accounts.select(1)).currentId).toBe(1);

        yield* drafts.setOutcome(thread.id, { status: "posted" });
        expect((yield* accounts.select(2)).currentId).toBe(2);
        expect((yield* Fiber.join(switches)).map((e) => e.payload)).toEqual([{ accountId: 2 }]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses an unknown account and stays on the current one", () =>
    Effect.gen(function* () {
      const accounts = yield* AccountStore.AccountStore;
      const error = yield* Effect.flip(accounts.select(99));
      expect(error.operation).toBe("select");
      expect((yield* accounts.list).currentId).toBe(1);
    }).pipe(Effect.provide(layerTest)),
  );
});

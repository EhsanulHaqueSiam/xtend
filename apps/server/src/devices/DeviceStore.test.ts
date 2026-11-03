import { describe, expect, it } from "@effect/vitest";
import { X_SKIN_DEFAULTS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpServerRequest } from "effect/http";

import * as ServiceAuth from "../auth/ServiceAuth.ts";
import * as ServerConfig from "../config.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as DeviceStore from "./DeviceStore.ts";

const config = (host: string) =>
  ServerConfig.layer({
    version: "test",
    port: 4820,
    host,
    baseDir: "/nowhere",
    dbPath: ":memory:",
    staticDir: undefined,
    devUrl: undefined,
    supervisor: "none",
  });

const layerTest = (host = "100.64.0.1") =>
  DeviceStore.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Sqlite.layerMemory,
        Events.layer,
        config(host),
        Layer.succeed(ServiceAuth.ServiceAuth)(
          ServiceAuth.make({ token: "m".repeat(64), allowedOrigins: new Set() }),
        ),
      ),
    ),
  );

/** Whether the service lets a request with this bearer token through. */
const lets = (token: string) =>
  Effect.map(ServiceAuth.ServiceAuth, (auth) =>
    auth.allows(
      HttpServerRequest.fromWeb(
        new Request("http://x/ws", { headers: { authorization: `Bearer ${token}` } }),
      ),
    ),
  );

const PREFS = { cleanX: ["ads" as const], updateChannel: "nightly" as const };

describe("DeviceStore", () => {
  it.effect("a pairing code buys one device token, which signing the device out revokes", () =>
    Effect.gen(function* () {
      const devices = yield* DeviceStore.DeviceStore;
      const pairing = yield* devices.pair;
      expect(pairing.link).toBe(`http://100.64.0.1:4820/pair#${pairing.code}`);

      const { token } = yield* devices.redeem({
        code: pairing.code,
        id: "macbook-1",
        name: "MacBook",
        prefs: PREFS,
      });
      expect(yield* lets(token)).toBe(true);
      const again = yield* Effect.flip(
        devices.redeem({ code: pairing.code, id: "other-1", name: "Other", prefs: PREFS }),
      );
      expect(again.detail).toMatch(/used or has expired/);

      // The relaunch onto this service starts the desktop on empty storage: its first hello
      // carries defaults, and the prefs it brought along at pairing must win.
      const DEFAULTS = { cleanX: X_SKIN_DEFAULTS, updateChannel: "stable" as const };
      expect((yield* devices.hello({ id: "macbook-1", name: "x", prefs: DEFAULTS })).prefs).toEqual(
        PREFS,
      );
      yield* devices.update({ id: "macbook-1", name: "Laptop", prefs: { ...PREFS, cleanX: [] } });
      const back = yield* devices.hello({ id: "macbook-1", name: "MacBook", prefs: PREFS });
      expect([back.name, back.prefs.cleanX, back.paired]).toEqual(["Laptop", [], true]);

      yield* devices.remove("macbook-1");
      expect(yield* lets(token)).toBe(false);
      expect(yield* devices.list).toEqual([]);
    }).pipe(Effect.provide(layerTest())),
  );

  it.effect(
    "a code runs out after ten minutes, and a loopback service has no link to hand out",
    () =>
      Effect.gen(function* () {
        const devices = yield* DeviceStore.DeviceStore;
        const pairing = yield* devices.pair;
        expect(pairing.link).toBeNull();
        yield* TestClock.adjust("10 minutes");
        const late = yield* Effect.flip(
          devices.redeem({ code: pairing.code, id: "late-0001", name: "L", prefs: PREFS }),
        );
        expect(late.operation).toBe("redeem");
      }).pipe(Effect.provide(layerTest("127.0.0.1"))),
  );

  it.effect("device tokens granted before a restart are accepted after it", () =>
    Effect.gen(function* () {
      const devices = yield* DeviceStore.DeviceStore;
      const { token } = yield* devices.redeem({
        code: (yield* devices.pair).code,
        id: "mini-0001",
        name: "Mac mini",
        prefs: PREFS,
      });
      const fresh = ServiceAuth.make({ token: "m".repeat(64), allowedOrigins: new Set() });
      yield* Layer.build(
        Layer.fresh(DeviceStore.layer).pipe(
          Layer.provide(Layer.succeed(ServiceAuth.ServiceAuth)(fresh)),
        ),
      );
      expect(
        fresh.allows(
          HttpServerRequest.fromWeb(
            new Request("http://x/ws", { headers: { authorization: `Bearer ${token}` } }),
          ),
        ),
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(layerTest())),
  );
});

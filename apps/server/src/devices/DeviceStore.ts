// @effect-diagnostics nodeBuiltinImport:off -- pairing codes and device tokens need the platform's CSPRNG.
import * as NodeCrypto from "node:crypto";

import {
  type Device,
  DevicePrefs,
  DevicesError,
  type Pairing,
  X_SKIN_DEFAULTS,
} from "@xtend/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServiceAuth from "../auth/ServiceAuth.ts";
import * as ServerConfig from "../config.ts";
import * as Events from "../events/Events.ts";

const PAIRING_MS = 10 * 60_000;
const UNREACHABLE_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"]);
const DEFAULT_PREFS: DevicePrefs = { cleanX: X_SKIN_DEFAULTS, updateChannel: null };

interface DeviceRow {
  readonly id: string;
  readonly name: string;
  readonly token_hash: string | null;
  readonly prefs: string | null;
  readonly created_at: string;
  readonly last_seen_at: string;
}

const PrefsJson = Schema.fromJsonString(DevicePrefs);
const decodePrefs = Schema.decodeUnknownOption(PrefsJson);
const encodePrefs = Schema.encodeSync(PrefsJson);
const isDevicesError = Schema.is(DevicesError);

export class DeviceStore extends Context.Service<
  DeviceStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Device>, DevicesError>;
    /** Marks the device seen, creating it with `prefs` the first time; returns what is stored. */
    readonly hello: (input: {
      readonly id: string;
      readonly name: string;
      readonly prefs: DevicePrefs;
    }) => Effect.Effect<Device, DevicesError>;
    readonly update: (input: {
      readonly id: string;
      readonly name?: string | undefined;
      readonly prefs?: DevicePrefs | undefined;
    }) => Effect.Effect<Device, DevicesError>;
    readonly remove: (id: string) => Effect.Effect<void, DevicesError>;
    /** A single-use code another desktop trades for a token of its own within ten minutes. */
    readonly pair: Effect.Effect<Pairing, DevicesError>;
    readonly redeem: (input: {
      readonly code: string;
      readonly id: string;
      readonly name: string;
      readonly prefs: DevicePrefs;
    }) => Effect.Effect<{ readonly token: string }, DevicesError>;
  }
>()("xtend/devices/DeviceStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const events = yield* Events.Events;
  const auth = yield* ServiceAuth.ServiceAuth;
  const config = yield* ServerConfig.ServerConfig;
  // In memory on purpose: a restart voids every open code, which only costs a new link.
  const codes = new Map<string, number>();

  const toDevice = (r: DeviceRow): Device => ({
    id: r.id,
    name: r.name,
    paired: r.token_hash !== null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    prefs: Option.getOrElse(decodePrefs(r.prefs), () => DEFAULT_PREFS),
  });
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const changed = (id: string) => events.publish({ type: "devices_changed", payload: { id } });
  const fail = (operation: DevicesError["operation"]) =>
    Effect.mapError((cause: unknown) =>
      isDevicesError(cause) ? cause : new DevicesError({ operation, detail: String(cause) }),
    );

  for (const row of yield* sql<{ token_hash: string }>`
    SELECT token_hash FROM devices WHERE token_hash IS NOT NULL
  `)
    auth.grant(row.token_hash);

  const list = sql<DeviceRow>`SELECT * FROM devices ORDER BY last_seen_at DESC`.pipe(
    Effect.map((rows) => rows.map(toDevice)),
    fail("list"),
  );

  const hello = Effect.fn("DeviceStore.hello")(function* (input: {
    readonly id: string;
    readonly name: string;
    readonly prefs: DevicePrefs;
  }) {
    const at = yield* now;
    // A name set from another device stays; prefs only fill in what pairing left empty.
    const rows = yield* sql<DeviceRow>`
        INSERT INTO devices (id, name, prefs, created_at, last_seen_at)
        VALUES (${input.id}, ${input.name}, ${encodePrefs(input.prefs)}, ${at}, ${at})
        ON CONFLICT (id) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          prefs = COALESCE(devices.prefs, excluded.prefs)
        RETURNING *
      `;
    yield* changed(input.id);
    return toDevice(rows[0]!);
  }, fail("hello"));

  const update = Effect.fn("DeviceStore.update")(function* (input: {
    readonly id: string;
    readonly name?: string | undefined;
    readonly prefs?: DevicePrefs | undefined;
  }) {
    const rows = yield* sql<DeviceRow>`
        UPDATE devices SET
          name = COALESCE(${input.name ?? null}, name),
          prefs = COALESCE(${input.prefs === undefined ? null : encodePrefs(input.prefs)}, prefs)
        WHERE id = ${input.id}
        RETURNING *
      `;
    const row = rows[0];
    if (row === undefined)
      return yield* new DevicesError({ operation: "update", detail: `no device ${input.id}` });
    yield* changed(input.id);
    return toDevice(row);
  }, fail("update"));

  // shortcut: a socket already open on the revoked token stays up until it drops; closing it needs per-connection tracking in the WS route.
  const remove = Effect.fn("DeviceStore.remove")(function* (id: string) {
    const rows = yield* sql<{ token_hash: string | null }>`
        DELETE FROM devices WHERE id = ${id} RETURNING token_hash
      `;
    const hash = rows[0]?.token_hash;
    if (hash !== undefined && hash !== null) auth.revoke(hash);
    yield* changed(id);
  }, fail("remove"));

  const pair = Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis;
    for (const [code, expires] of codes) if (expires <= at) codes.delete(code);
    const code = NodeCrypto.randomBytes(16).toString("base64url");
    const expires = at + PAIRING_MS;
    codes.set(code, expires);
    const reachable = !UNREACHABLE_HOSTS.has(config.host);
    const host = config.host.includes(":") ? `[${config.host}]` : config.host;
    return {
      code,
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expires)),
      link: reachable ? `http://${host}:${config.port}/pair#${code}` : null,
    };
  });

  const redeem = Effect.fn("DeviceStore.redeem")(function* (input: {
    readonly code: string;
    readonly id: string;
    readonly name: string;
    readonly prefs: DevicePrefs;
  }) {
    const expires = codes.get(input.code);
    codes.delete(input.code);
    if (expires === undefined || expires <= (yield* Clock.currentTimeMillis))
      return yield* new DevicesError({
        operation: "redeem",
        detail: "this pairing link was used or has expired; make a new one",
      });
    const token = NodeCrypto.randomBytes(32).toString("hex");
    const hash = ServiceAuth.hashToken(token);
    const at = yield* now;
    // A device paired again (after a reinstall of the service's side) swaps its old token out.
    const old = yield* sql<{ token_hash: string | null }>`
        SELECT token_hash FROM devices WHERE id = ${input.id}
      `;
    yield* sql`
        INSERT INTO devices (id, name, token_hash, prefs, created_at, last_seen_at)
        VALUES (${input.id}, ${input.name}, ${hash}, ${encodePrefs(input.prefs)}, ${at}, ${at})
        ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, last_seen_at = excluded.last_seen_at
      `;
    const previous = old[0]?.token_hash;
    if (previous !== undefined && previous !== null) auth.revoke(previous);
    auth.grant(hash);
    yield* changed(input.id);
    return { token };
  }, fail("redeem"));

  return DeviceStore.of({ list, hello, update, remove, pair, redeem });
});

export const layer = Layer.effect(DeviceStore, make).pipe(Layer.provide(Events.layer));

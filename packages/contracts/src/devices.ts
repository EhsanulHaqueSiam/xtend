import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime } from "./baseSchemas.ts";
import { X_SKIN_TOGGLES } from "./x.ts";

/**
 * Devices: the desktops that use this service. One service holds the user's data, so every
 * other machine joins it with a pairing link instead of starting an empty one of its own. A
 * device's own preferences live here too, so any device can change them; the device applies
 * them when they change. Devices are machines, not accounts: they are not account-scoped.
 */
export const UpdateChannel = Schema.Literals(["stable", "nightly"]);
export type UpdateChannel = typeof UpdateChannel.Type;

export const DevicePrefs = Schema.Struct({
  /** The Clean X toggles the device puts over its x.com. */
  cleanX: Schema.Array(Schema.Literals(X_SKIN_TOGGLES.map((t) => t.id))),
  /** The release channel the desktop follows; null for a build that does not update itself. */
  updateChannel: Schema.NullOr(UpdateChannel),
});
export type DevicePrefs = typeof DevicePrefs.Type;

/** Desktops pick their own id once (a UUID in their config) and keep it across services. */
export const DeviceId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{8,64}$/));

export const Device = Schema.Struct({
  id: DeviceId,
  name: Schema.String,
  /** Joined with a pairing link, so it has a token of its own that signing out revokes. */
  paired: Schema.Boolean,
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  prefs: DevicePrefs,
});
export type Device = typeof Device.Type;

const DeviceName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

/** What a desktop sends on every start. `prefs` is used only the first time, to keep what it had. */
export const DeviceHello = Schema.Struct({ id: DeviceId, name: DeviceName, prefs: DevicePrefs });

export const DeviceUpdate = Schema.Struct({
  id: DeviceId,
  name: Schema.optional(DeviceName),
  prefs: Schema.optional(DevicePrefs),
});

export const Pairing = Schema.Struct({
  /** Single use; the joining desktop presents it to `PAIR_PATH`. */
  code: Schema.String,
  expiresAt: IsoDateTime,
  /** The link to open on the other device; null while the service only listens on loopback. */
  link: Schema.NullOr(Schema.String),
});
export type Pairing = typeof Pairing.Type;

/**
 * POST body of `PAIR_PATH`. No service token: the code is the credential. `prefs` are what the
 * desktop had, since the relaunch onto the new service starts it on an empty page storage.
 */
export const PairRedeem = Schema.Struct({
  code: Schema.String,
  id: DeviceId,
  name: DeviceName,
  prefs: DevicePrefs,
});
export const PairRedeemed = Schema.Struct({ token: Schema.String });

export const PAIR_PATH = "/api/pair";

export class DevicesError extends Schema.TaggedError<DevicesError>()("DevicesError", {
  operation: Schema.Literals(["list", "hello", "update", "remove", "pair", "redeem"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Devices ${this.operation} failed: ${this.detail}`;
  }
}

export const Devices_METHODS = {
  list: "devices.list",
  hello: "devices.hello",
  update: "devices.update",
  remove: "devices.remove",
  pair: "devices.pair",
} as const;

export const DevicesRpcGroup = RpcGroup.make(
  Rpc.make(Devices_METHODS.list, {
    payload: Schema.Struct({}),
    success: Schema.Array(Device),
    error: DevicesError,
  }),
  Rpc.make(Devices_METHODS.hello, { payload: DeviceHello, success: Device, error: DevicesError }),
  Rpc.make(Devices_METHODS.update, { payload: DeviceUpdate, success: Device, error: DevicesError }),
  /** Forgets the device and revokes its token; it needs a new pairing link to come back. */
  Rpc.make(Devices_METHODS.remove, {
    payload: Schema.Struct({ id: DeviceId }),
    success: Schema.Struct({}),
    error: DevicesError,
  }),
  Rpc.make(Devices_METHODS.pair, {
    payload: Schema.Struct({}),
    success: Pairing,
    error: DevicesError,
  }),
);

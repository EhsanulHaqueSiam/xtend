import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { type DevicePrefs, PAIR_PATH, PairRedeemed } from "@xtend/contracts";
import * as Schema from "effect/Schema";

/**
 * The desktop's own config: which service to talk to. Kept outside the service
 * DB because it is read before any service answers, and because pointing at a
 * Mac mini means the local DB is not the one in use.
 */
export const RemoteConfig = Schema.Struct({
  // Startup builds every service URL from this; one that does not parse would keep the window from opening.
  url: Schema.String.check(
    Schema.makeFilter((url) => URL.canParse(url) && /^https?:$/.test(new URL(url).protocol), {
      message: "an http(s) URL",
    }),
  ),
  token: Schema.String,
});
export type RemoteConfig = typeof RemoteConfig.Type;

const ConfigFile = Schema.fromJsonString(
  Schema.Struct({
    remote: Schema.NullOr(RemoteConfig),
    /** This desktop on every service it joins, so its preferences follow it. */
    deviceId: Schema.optional(Schema.String),
  }),
);
const decodeConfigFile = Schema.decodeUnknownResult(ConfigFile);
const encodeConfigFile = Schema.encodeSync(ConfigFile);

const readConfig = (file: string): typeof ConfigFile.Type | null => {
  let text: string;
  try {
    text = NodeFS.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const decoded = decodeConfigFile(text);
  return decoded._tag === "Success" ? decoded.success : null;
};

const writeConfig = (file: string, config: typeof ConfigFile.Type): void => {
  // The device id is written at startup, before Electron has made the userData directory.
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, encodeConfigFile(config), { mode: 0o600 });
};

export const readRemote = (file: string): RemoteConfig | null => readConfig(file)?.remote ?? null;

export const writeRemote = (file: string, remote: RemoteConfig | null): void => {
  const deviceId = readConfig(file)?.deviceId;
  writeConfig(file, deviceId === undefined ? { remote } : { remote, deviceId });
};

/** This desktop's id, made on first use and kept in the config from then on. */
export const readDeviceId = (file: string): string => {
  const config = readConfig(file);
  if (config?.deviceId !== undefined) return config.deviceId;
  const deviceId = NodeCrypto.randomUUID();
  writeConfig(file, { remote: config?.remote ?? null, deviceId });
  return deviceId;
};

/** `http://host:4820/pair#<code>` as the service URL and the code; anything else is not a link. */
const parsePairingLink = (link: string): { readonly url: string; readonly code: string } | null => {
  if (!URL.canParse(link.trim())) return null;
  const parsed = new URL(link.trim());
  const code = parsed.hash.slice(1);
  if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/pair" || code === "") return null;
  return { url: parsed.origin, code };
};

const Refused = Schema.Struct({ message: Schema.String });
const decodeRedeemed = Schema.decodeUnknownResult(PairRedeemed);
const decodeRefused = Schema.decodeUnknownResult(Refused);

/** Trades a pairing link's code for this device's own token on that service. */
export async function redeemPairing(
  link: string,
  device: { readonly id: string; readonly name: string; readonly prefs: DevicePrefs },
  post: (
    url: string,
    body: string,
  ) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>,
): Promise<{ readonly remote: RemoteConfig } | { readonly error: string }> {
  const pairing = parsePairingLink(link);
  if (pairing === null)
    return { error: "not a pairing link; copy it from Settings, Service on the other device" };
  try {
    const response = await post(
      new URL(PAIR_PATH, pairing.url).toString(),
      JSON.stringify({ code: pairing.code, ...device }),
    );
    const body = await response.json().catch(() => null);
    const redeemed = decodeRedeemed(body);
    if (response.ok && redeemed._tag === "Success")
      return { remote: { url: pairing.url, token: redeemed.success.token } };
    const refused = decodeRefused(body);
    return {
      error: refused._tag === "Success" ? refused.success.message : "the service refused the link",
    };
  } catch (error) {
    return { error: `could not reach ${pairing.url}: ${String(error)}` };
  }
}

export interface Reachability {
  /** GET /api/health answered with the service's name. */
  readonly health: boolean;
  readonly version: string | null;
  /** The WebSocket upgrade with the token was accepted. */
  readonly auth: boolean;
  readonly error: string | null;
}

export interface ReachabilityDeps {
  readonly fetch: (
    url: string,
  ) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;
  /** Resolves true when a socket to the URL opens, false when the server refuses it. */
  readonly openSocket: (url: string) => Promise<boolean>;
}

const Health = Schema.Struct({ name: Schema.Literal("xtend"), version: Schema.String });
const decodeHealth = Schema.decodeUnknownResult(Health);

/** Health first (is anything there), then an authenticated socket (is the token right). */
export async function checkRemote(
  config: RemoteConfig,
  deps: ReachabilityDeps,
): Promise<Reachability> {
  let base: URL;
  try {
    base = new URL(config.url);
  } catch {
    return { health: false, version: null, auth: false, error: "not a URL" };
  }
  try {
    const response = await deps.fetch(new URL("/api/health", base).toString());
    const health = response.ok ? decodeHealth(await response.json()) : null;
    if (health === null || health._tag === "Failure")
      return { health: false, version: null, auth: false, error: "no xtend service at this URL" };
    const ws = new URL("/ws", base);
    ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
    ws.search = `?token=${encodeURIComponent(config.token)}`;
    const auth = await deps.openSocket(ws.toString());
    return {
      health: true,
      version: health.success.version,
      auth,
      error: auth ? null : "the service refused the token",
    };
  } catch (error) {
    return { health: false, version: null, auth: false, error: String(error) };
  }
}

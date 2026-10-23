import * as fs from "node:fs";

import * as Schema from "effect/Schema";

/**
 * The desktop's own config: which service to talk to. Kept outside the service
 * DB because it is read before any service answers, and because pointing at a
 * Mac mini means the local DB is not the one in use.
 */
export const RemoteConfig = Schema.Struct({ url: Schema.String, token: Schema.String });
export type RemoteConfig = typeof RemoteConfig.Type;

const ConfigFile = Schema.fromJsonString(Schema.Struct({ remote: Schema.NullOr(RemoteConfig) }));
const decodeConfigFile = Schema.decodeUnknownResult(ConfigFile);
const encodeConfigFile = Schema.encodeSync(ConfigFile);

export const readRemote = (file: string): RemoteConfig | null => {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const decoded = decodeConfigFile(text);
  return decoded._tag === "Success" ? decoded.success.remote : null;
};

export const writeRemote = (file: string, remote: RemoteConfig | null): void => {
  fs.writeFileSync(file, encodeConfigFile({ remote }), { mode: 0o600 });
};

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

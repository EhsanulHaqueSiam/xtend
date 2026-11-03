import { HEALTH_PATH, PAIR_PATH, PairRedeemed, ServiceHealth, WS_METHODS } from "@xtend/contracts";
import * as Schema from "effect/Schema";

import { saveService } from "./client";

const ANSWER_MS = 8_000;
// Browsers let an https page reach these over plain http and ws; every other host is mixed content.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Problem =
  | { readonly kind: "address" }
  | { readonly kind: "https"; readonly port: string; readonly address: string }
  | { readonly kind: "unreachable" }
  | { readonly kind: "origin"; readonly page: string }
  | { readonly kind: "credential"; readonly message: string };

export type Outcome =
  | {
      readonly ok: true;
      readonly origin: string;
      readonly version: string;
      readonly ms: number;
    }
  | {
      readonly ok: false;
      readonly field: "address" | "credential";
      readonly problem: Problem;
      /** The service answered, so the address field shows it was found. */
      readonly version?: string;
    };

const decodeHealth = Schema.decodeUnknownOption(ServiceHealth);
const decodeRedeemed = Schema.decodeUnknownOption(PairRedeemed);
const decodeRefused = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

/** `https://host/pair#<code>`'s code and origin; null for anything else, which is read as a token. */
const pairingLink = (text: string) => {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  const code = url.hash.slice(1);
  return url.pathname === "/pair" && code !== "" ? { origin: url.origin, code } : null;
};

/** A typed address may leave out the scheme; a hosted page is https, so that is the guess. */
const parseAddress = (text: string) => {
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  if (!URL.canParse(withScheme)) return null;
  const url = new URL(withScheme);
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
};

const fetchOrNull = (input: string, init?: RequestInit) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(ANSWER_MS) }).catch(() => null);

/**
 * Checks the address, then the pairing link or token, and on success remembers the service for
 * this browser. Failures name the field they belong under. A pairing link is traded for a device
 * token of this browser's own; a raw token is checked against one read-only method.
 */
export async function connect(input: {
  readonly address: string;
  readonly credential: string;
  /** The page's protocol: an https page cannot open http or ws to another host. */
  readonly secure: boolean;
}): Promise<Outcome> {
  const credential = input.credential.trim();
  const link = pairingLink(credential);
  const address = parseAddress(input.address.trim() || (link?.origin ?? ""));
  if (address === null) return { ok: false, field: "address", problem: { kind: "address" } };
  if (input.secure && address.protocol === "http:" && !LOOPBACK.has(address.hostname))
    return {
      ok: false,
      field: "address",
      problem: { kind: "https", port: address.port || "80", address: address.origin },
    };
  const origin = address.origin;
  const started = performance.now();
  const health = await fetchOrNull(`${origin}${HEALTH_PATH}`);
  const body = health?.ok === true ? await health.json().catch(() => null) : null;
  const found = decodeHealth(body);
  if (found._tag === "None")
    return { ok: false, field: "address", problem: { kind: "unreachable" } };
  const version = found.value.version;
  const ms = Math.round(performance.now() - started);
  // The service answered its open health route, so a blocked call below is CORS: this page's origin.
  const refusedOrigin = {
    ok: false,
    field: "address",
    problem: { kind: "origin", page: window.location.origin },
    version,
  } as const;
  const refused = (message: string) =>
    ({
      ok: false,
      field: "credential",
      problem: { kind: "credential", message },
      version,
    }) as const;

  if (link !== null) {
    const response = await fetchOrNull(`${origin}${PAIR_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: link.code,
        // @effect-diagnostics-next-line cryptoRandomUUID:off -- a plain async handler, not an Effect
        id: crypto.randomUUID(),
        name: `Browser at ${window.location.host}`.slice(0, 64),
        prefs: { cleanX: [], updateChannel: null },
      }),
    });
    if (response === null) return refusedOrigin;
    const reply: unknown = await response.json().catch(() => null);
    const redeemed = decodeRedeemed(reply);
    if (!response.ok || redeemed._tag === "None") {
      const why = decodeRefused(reply);
      const message = why._tag === "Some" ? why.value.message : "the service refused this link";
      return refused(
        `${message.charAt(0).toUpperCase()}${message.slice(1)}. On the desktop: Settings, Service, Add a device.`,
      );
    }
    saveService(origin, { device: redeemed.value.token });
    return { ok: true, origin, version, ms };
  }

  if (credential === "") return refused("Paste a pairing link or the service's token.");
  const response = await fetchOrNull(`${origin}/api/rpc/${WS_METHODS.serverInfo}`, {
    method: "POST",
    headers: { authorization: `Bearer ${credential}` },
  });
  if (response === null) return refusedOrigin;
  if (response.status === 401)
    return refused(
      "The service does not know this token, or it was signed out. Copy it again from auth-token in its data directory, or use a pairing link.",
    );
  if (!response.ok) return refused(`The service answered ${response.status}.`);
  saveService(origin, { service: credential });
  return { ok: true, origin, version, ms };
}

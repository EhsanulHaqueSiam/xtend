import { WS_PATH, WsRpcGroup } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Atom from "effect/reactivity/Atom";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;

export class XtendClient extends Context.Service<XtendClient, Client>()(
  "@xtend/web/rpc/client/XtendClient",
) {}

const TOKEN_KEY = "xtend:token";
const SERVICE_KEY = "xtend:service";

const SavedService = Schema.fromJsonString(
  Schema.Struct({
    url: Schema.String,
    /** A device token from a pairing link: revocable from Devices, so it may outlive the tab. */
    token: Schema.optional(Schema.String),
  }),
);
const decodeSaved = Schema.decodeUnknownOption(SavedService);
const encodeSaved = Schema.encodeSync(SavedService);

const readStorage = (storage: () => Storage, key: string) => {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
};

/** The service the connect screen saved on this browser, if any. */
export const savedService = () =>
  Option.getOrNull(decodeSaved(readStorage(() => window.localStorage, SERVICE_KEY)));

/**
 * Remembers the service a hosted page connects to. A device token is kept with the address; the
 * service's own token, which nothing can revoke, stays in this tab only, as a `?token=` link's does.
 */
export const saveService = (
  url: string,
  token: { readonly device: string } | { readonly service: string },
) => {
  if ("device" in token) {
    window.localStorage.setItem(SERVICE_KEY, encodeSaved({ url, token: token.device }));
    window.sessionStorage.removeItem(TOKEN_KEY);
  } else {
    window.localStorage.setItem(SERVICE_KEY, encodeSaved({ url }));
    window.sessionStorage.setItem(TOKEN_KEY, token.service);
  }
};

/** Forgets the saved service and its token; the page shows the connect screen again. */
export const forgetService = () => {
  window.localStorage.removeItem(SERVICE_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
};

/**
 * The service and token, first found: the desktop's; the dev server's (fetched later); the page a
 * packaged service served; the one the connect screen saved; or a one-time `?token=`, kept for the
 * tab and always stripped from the address bar. Null: a hosted page nobody connected yet.
 */
export const pageService = () => {
  const own = window.location.origin;
  const url = new URL(window.location.href);
  const param = url.searchParams.get("token");
  if (param !== null) {
    window.sessionStorage.setItem(TOKEN_KEY, param);
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url);
  }
  const fromDesktop = window.desktopBridge?.serviceToken;
  if (fromDesktop !== undefined && fromDesktop !== "") return { origin: own, token: fromDesktop };
  if (import.meta.env.DEV) return { origin: own, token: undefined };
  const meta = document.querySelector<HTMLMetaElement>('meta[name="xtend-token"]')?.content;
  if (meta !== undefined && meta !== "") return { origin: own, token: meta };
  const saved = savedService();
  const token = saved?.token ?? readStorage(() => window.sessionStorage, TOKEN_KEY);
  return token === null ? null : { origin: saved?.url ?? own, token };
};

/** Base URL of the service's HTTP routes: the page's own origin unless it was connected elsewhere. */
export const serviceOrigin = () => pageService()?.origin ?? window.location.origin;

const target = Effect.gen(function* () {
  const found = pageService();
  const origin = found?.origin ?? window.location.origin;
  if (found?.token !== undefined) return { origin, token: found.token };
  if (import.meta.env.DEV) {
    const { token } = yield* Effect.promise(() =>
      // @effect-diagnostics-next-line globalFetchInEffect:off -- read once, before the RPC client and any HTTP layer exist
      fetch("/api/auth/dev-token", { method: "POST" }).then(
        (r) => r.json() as Promise<{ token: string }>,
      ),
    );
    return { origin, token };
  }
  return { origin, token: "" };
});

export const serviceToken = Effect.map(target, (t) => t.token);

// The page's own origin unless the connect screen saved another: Vite proxies /ws in dev, the
// service serves both in prod, and a hosted page reaches the user's service by its address.
export const socketUrl = Effect.map(target, ({ origin, token }) => {
  const url = new URL(WS_PATH, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = `?token=${encodeURIComponent(token)}`;
  return url.toString();
});

const layerProtocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(Socket.layerWebSocket(socketUrl)),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson),
);

const layerClient = Layer.effect(XtendClient, makeClient).pipe(Layer.provide(layerProtocol));

/** One runtime for the whole UI; every atom that talks to the service builds on it. */
export const clientRuntime = Atom.runtime(layerClient);

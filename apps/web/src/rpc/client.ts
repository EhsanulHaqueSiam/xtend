import { WS_PATH, WsRpcGroup } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

/**
 * The service token, first found: the desktop's; the dev server's (the service answers only that
 * origin); the page a packaged service served; or a remote browser's one-time `?token=`, kept for
 * the tab and always stripped from the address bar and history.
 */
export const serviceToken = Effect.gen(function* () {
  const url = new URL(window.location.href);
  const param = url.searchParams.get("token");
  if (param !== null) {
    window.sessionStorage.setItem(TOKEN_KEY, param);
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url);
  }
  const fromDesktop = window.desktopBridge?.serviceToken;
  if (fromDesktop !== undefined && fromDesktop !== "") return fromDesktop;
  if (import.meta.env.DEV) {
    const { token } = yield* Effect.promise(() =>
      // @effect-diagnostics-next-line globalFetchInEffect:off -- read once, before the RPC client and any HTTP layer exist
      fetch("/api/auth/dev-token", { method: "POST" }).then(
        (r) => r.json() as Promise<{ token: string }>,
      ),
    );
    return token;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="xtend-token"]')?.content;
  if (meta !== undefined && meta !== "") return meta;
  return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
});

// Same origin as the page: Vite proxies /ws in dev, the service serves both in prod,
// and a remote browser reaches whatever host it loaded the UI from.
const socketUrl = Effect.map(serviceToken, (token) => {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = WS_PATH;
  url.search = `?token=${encodeURIComponent(token)}`;
  url.hash = "";
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

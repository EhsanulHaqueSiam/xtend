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

export class XtendClient extends Context.Service<XtendClient, Client>()("xtend/web/XtendClient") {}

const TOKEN_KEY = "xtend:token";

/**
 * The service token, in order: the desktop already holds it; the Vite dev
 * server asks the service, which answers only that origin; a packaged build
 * has it in the page the service served; a remote browser brings it once as
 * `?token=` and keeps it for the tab. That one leaves the address bar and
 * history first, whichever token wins.
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

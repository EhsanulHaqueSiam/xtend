import { WS_PATH, WsRpcGroup } from "@corvid/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Atom from "effect/reactivity/Atom";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;

export class CorvidClient extends Context.Service<CorvidClient, Client>()(
  "corvid/web/CorvidClient",
) {}

// Same origin as the page: Vite proxies /ws in dev, the service serves both in prod,
// and a remote browser reaches whatever host it loaded the UI from.
const socketUrl = () => {
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = WS_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
};

const layerProtocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide(Socket.layerWebSocket(socketUrl())),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(RpcSerialization.layerJson),
);

const layerClient = Layer.effect(CorvidClient, makeClient).pipe(Layer.provide(layerProtocol));

/** One runtime for the whole UI; every atom that talks to the service builds on it. */
export const clientRuntime = Atom.runtime(layerClient);

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

import * as Metrics from "./Metrics.ts";

export type RpcTransport = "ws" | "http";

/** One span (`ws.rpc.<method>`, `http.rpc.<method>`) and the request metrics around a handler. */
export const instrument =
  (method: string, transport: RpcTransport) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Metrics.withMetrics({
        counter: Metrics.rpcRequestsTotal,
        timer: Metrics.rpcRequestDuration,
        attributes: { method, transport },
      }),
      Effect.withSpan(`${transport}.rpc.${method}`, {
        kind: "server",
        attributes: { "rpc.method": method, "rpc.transport": transport },
      }),
    );

/** Added to the socket's group in `ws.ts`; the HTTP bridge calls `instrument` itself. */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "xtend/observability/RpcInstrumentation",
) {}

export const layer = Layer.succeed(RpcInstrumentation)((effect, { rpc }) =>
  instrument(rpc._tag, "ws")(effect),
);

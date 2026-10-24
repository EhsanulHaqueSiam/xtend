// @effect-diagnostics anyUnknownInErrorContext:off -- the bridge dispatches erased rpcs; their schemas re-type the wire.
import { WsRpcGroup } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMessage from "effect/rpc/RpcMessage";

import * as ServiceAuth from "../auth/ServiceAuth.ts";
import { layerHandlers } from "../ws.ts";

/** One client id for every HTTP caller; nothing here calls back into a client. */
const httpClient = new Rpc.ServerClient(0);

const json = (body: unknown, status: number) => HttpServerResponse.json(body, { status });

/** An rpc's schema as seen from here: the contracts never need decoding services. */
const erased = (schema: Schema.Top) => schema as Schema.Codec<unknown, unknown>;

/**
 * `POST /api/rpc/<method>` with a JSON payload dispatches to the same handler
 * the WebSocket uses and answers the encoded success (200), the rpc's own error
 * (422), a payload that failed to decode (400) or a defect (500). Streaming
 * rpcs stay on the socket.
 */
export const handlerFor = <R extends Rpc.AnyWithProps>(group: RpcGroup.RpcGroup<R>) =>
  ServiceAuth.guarded(
    Effect.gen(function* () {
      const method = (yield* HttpRouter.params)["method"] ?? "";
      const rpc = group.requests.get(method);
      if (rpc === undefined) return yield* json({ error: "unknown_method", method }, 404);
      const request = yield* HttpServerRequest.HttpServerRequest;
      // An empty body is the empty payload most read methods take. Malformed JSON is refused:
      // read as {} it would run a method with every option at its default.
      const body = yield* Effect.result(request.json);
      if (body._tag === "Failure")
        return yield* json({ error: "invalid_payload", message: "body is not JSON" }, 400);
      const decoded = Schema.decodeUnknownResult(erased(rpc.payloadSchema))(body.success ?? {});
      if (decoded._tag === "Failure")
        return yield* json({ error: "invalid_payload", message: decoded.failure.message }, 400);
      // Same lookup RpcGroup.accessHandler does, typed so the handler layer satisfies it.
      const context = yield* Effect.context<Rpc.ToHandler<R>>();
      const entry = Context.getOrUndefined(context, Context.Service<Rpc.Handler<string>>(rpc.key));
      if (entry === undefined) return yield* json({ error: "no_handler", method }, 500);
      const result = entry.handler(decoded.success, {
        client: httpClient,
        requestId: RpcMessage.RequestId(0),
        headers: Headers.empty,
        rpc,
      });
      const run: Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown> = Rpc.isWrapper(
        result,
      )
        ? result.value
        : result;
      if (!Effect.isEffect(run)) return yield* json({ error: "stream_only_over_ws", method }, 400);
      const exit = yield* Effect.exit(Effect.provide(run, entry.context));
      if (Exit.isSuccess(exit))
        return yield* json(Schema.encodeUnknownSync(erased(rpc.successSchema))(exit.value), 200);
      const failure = Cause.findErrorOption(exit.cause);
      if (Option.isSome(failure))
        return yield* json(
          { error: Schema.encodeUnknownSync(erased(rpc.errorSchema))(failure.value) },
          422,
        );
      return yield* json({ error: "defect", message: String(Cause.squash(exit.cause)) }, 500);
    }).pipe(
      Effect.scoped,
      Effect.catchCause((cause) =>
        json({ error: "defect", message: String(Cause.squash(cause)) }, 500),
      ),
      // Only a JSON body that cannot be serialised is left, and that is a bug, not a request error.
      Effect.orDie,
    ),
  );

/** The same handler layer as the socket, built inside the route so it sees every area service. */
export const layerRoute = HttpRouter.add(
  "POST",
  "/api/rpc/:method",
  handlerFor(WsRpcGroup).pipe(Effect.provide(layerHandlers)),
);

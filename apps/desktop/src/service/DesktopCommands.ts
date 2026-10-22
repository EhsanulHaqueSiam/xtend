import { WS_METHODS, WS_PATH, WsRpcGroup, type DesktopCommand } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

export interface DesktopCommandHandlers {
  readonly sessionScreenshot: () => Promise<string>;
}

const socketUrl = (serviceUrl: string) => {
  const url = new URL(WS_PATH, serviceUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/**
 * Keeps one RPC connection to the service and answers the commands it sends
 * (today: screenshot the X view). Reconnects forever; the service treats a
 * missing desktop as "not connected" rather than queueing.
 */
export function startDesktopCommands(
  serviceUrl: string,
  handlers: DesktopCommandHandlers,
  log: (message: string, detail?: unknown) => void,
): () => void {
  const layerProtocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Socket.layerWebSocket(socketUrl(serviceUrl))),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );

  const run = (command: DesktopCommand) =>
    Effect.promise(() => handlers.sessionScreenshot()).pipe(
      Effect.map((pngBase64) => ({ commandId: command.commandId, pngBase64, error: null })),
      Effect.catchCause((cause) =>
        Effect.succeed({
          commandId: command.commandId,
          pngBase64: null,
          error: String(cause).slice(0, 300),
        }),
      ),
    );

  const serve = Effect.gen(function* () {
    const client = yield* RpcClient.make(WsRpcGroup);
    yield* client[WS_METHODS.desktopSubscribeCommands]({}).pipe(
      Stream.mapEffect((command) =>
        run(command).pipe(
          Effect.flatMap((result) => client[WS_METHODS.desktopCompleteCommand](result)),
        ),
      ),
      Stream.runDrain,
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(layerProtocol),
    Effect.tapError((error) =>
      Effect.sync(() => log("service command link dropped", String(error))),
    ),
    Effect.retry(Schedule.spaced("3 seconds")),
  );

  const fiber = Effect.runFork(serve);
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
}

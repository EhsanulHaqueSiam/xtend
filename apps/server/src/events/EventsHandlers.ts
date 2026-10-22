import { Events_METHODS, EventsRpcGroup } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Events from "./Events.ts";

/** Clients treat a 45 s silence as a dropped socket, so beat well inside that. */
const HEARTBEAT = "30 seconds";

const layerHeartbeat = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* Events.Events;
    yield* Stream.tick(HEARTBEAT).pipe(
      Stream.runForEach(() => events.publish({ type: "service_state", payload: { ok: true } })),
      Effect.forkScoped,
    );
  }),
);

/** The heartbeat only; Events itself is provided from layerFoundation in server.ts. */
export const layer = layerHeartbeat;

/** RPC handlers for EventsRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = EventsRpcGroup.toLayer(
  Effect.gen(function* () {
    const events = yield* Events.Events;
    return EventsRpcGroup.of({
      // A first beat on subscribe lets the client mark itself connected at once.
      [Events_METHODS.subscribe]: () =>
        Stream.concat(
          Stream.fromEffect(
            Effect.map(DateTime.now, (now) => ({
              type: "service_state" as const,
              at: DateTime.formatIso(now),
              payload: { ok: true },
            })),
          ),
          events.stream,
        ),
    });
  }),
);

import type { XtendEvent, XtendEventType } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export interface EventInput {
  readonly type: XtendEventType;
  readonly payload?: Record<string, unknown>;
}

/**
 * Fan-out of live events to every connected client; publish is a no-op without
 * subscribers. Areas depend on it with `Layer.provide(Events.layer)`: Effect
 * memoizes a layer by reference, so every area shares the one hub.
 */
export class Events extends Context.Service<
  Events,
  {
    readonly publish: (event: EventInput) => Effect.Effect<void>;
    /** Events published after subscribing. No history. */
    readonly stream: Stream.Stream<XtendEvent>;
    /** Whether any client is subscribed now; an event worth telling once waits for one. */
    readonly listening: Effect.Effect<boolean>;
  }
>()("xtend/events/Events") {}

const make = Effect.gen(function* () {
  // Sliding so a client that stops reading can never block the publisher.
  const hub = yield* PubSub.sliding<XtendEvent>(256);
  let subscribers = 0;
  return Events.of({
    publish: Effect.fn("Events.publish")(function* ({ type, payload = {} }) {
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* PubSub.publish(hub, { type, at, payload });
    }),
    stream: Stream.unwrap(
      Effect.acquireRelease(
        Effect.sync(() => void subscribers++),
        () => Effect.sync(() => void subscribers--),
      ).pipe(Effect.as(Stream.fromPubSub(hub))),
    ),
    listening: Effect.sync(() => subscribers > 0),
  });
});

export const layer = Layer.effect(Events, make);

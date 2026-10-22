import {
  type DesktopCommand,
  type DesktopCommandId,
  type DesktopCommandResult,
  DesktopUnavailableError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

const COMMAND_TIMEOUT = Duration.seconds(20);

/**
 * The service's only way to reach the X session: it asks a connected desktop
 * and waits. There is no queue; a command with nobody listening fails at once
 * so the agent can tell the user to open the desktop.
 */
export class DesktopChannel extends Context.Service<
  DesktopChannel,
  {
    readonly commands: Stream.Stream<DesktopCommand>;
    readonly request: (
      kind: DesktopCommand["kind"],
    ) => Effect.Effect<DesktopCommandResult, DesktopUnavailableError>;
    readonly complete: (result: DesktopCommandResult) => Effect.Effect<void>;
  }
>()("xtend/agent/DesktopChannel") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const commands = yield* PubSub.unbounded<DesktopCommand>();
  const listeners = yield* Ref.make(0);
  const pending = yield* Ref.make(
    new Map<DesktopCommandId, Deferred.Deferred<DesktopCommandResult>>(),
  );

  const commandStream = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(commands);
      yield* Ref.update(listeners, (n) => n + 1);
      yield* Effect.addFinalizer(() => Ref.update(listeners, (n) => n - 1));
      return Stream.fromSubscription(subscription);
    }),
  );

  const request = Effect.fn("DesktopChannel.request")(function* (kind: DesktopCommand["kind"]) {
    if ((yield* Ref.get(listeners)) === 0) {
      return yield* new DesktopUnavailableError({ reason: "not_connected" });
    }
    const commandId = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)) as DesktopCommandId;
    const done = yield* Deferred.make<DesktopCommandResult>();
    yield* Ref.update(pending, (map) => new Map(map).set(commandId, done));
    yield* PubSub.publish(commands, { commandId, kind });
    const result = yield* Deferred.await(done).pipe(
      Effect.timeoutOption(COMMAND_TIMEOUT),
      Effect.ensuring(
        Ref.update(pending, (map) => {
          const next = new Map(map);
          next.delete(commandId);
          return next;
        }),
      ),
    );
    if (result._tag === "None") return yield* new DesktopUnavailableError({ reason: "timed_out" });
    if (result.value.error !== null)
      return yield* new DesktopUnavailableError({ reason: "failed" });
    return result.value;
  });

  const complete = Effect.fn("DesktopChannel.complete")(function* (result: DesktopCommandResult) {
    const done = (yield* Ref.get(pending)).get(result.commandId);
    if (done !== undefined) yield* Deferred.succeed(done, result);
  });

  return DesktopChannel.of({ commands: commandStream, request, complete });
});

export const layer = Layer.effect(DesktopChannel, make);

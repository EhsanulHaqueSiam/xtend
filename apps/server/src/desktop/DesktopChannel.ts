import {
  type DesktopCommand,
  type DesktopCommandCompletion,
  type DesktopCommandRequest,
  type DesktopCommandResult,
  type DesktopCommandResultFor,
  DesktopUnavailableError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

const COMMAND_TIMEOUT_MS = 20_000;

/**
 * The service's one door to the desktop. A connected desktop subscribes to the
 * command stream; `request` publishes a command and waits for its completion.
 * With no desktop subscribed a request fails at once instead of waiting out
 * the timeout, so compose can fall back without stalling.
 */
export class DesktopChannel extends Context.Service<
  DesktopChannel,
  {
    readonly request: <C extends DesktopCommand>(
      command: C,
    ) => Effect.Effect<DesktopCommandResultFor<C>, DesktopUnavailableError>;
    readonly subscribe: Stream.Stream<DesktopCommandRequest>;
    readonly complete: (completion: DesktopCommandCompletion) => Effect.Effect<void>;
    readonly connected: Effect.Effect<boolean>;
  }
>()("xtend/desktop/DesktopChannel") {}

const make = Effect.gen(function* () {
  const commands = yield* PubSub.unbounded<DesktopCommandRequest>();
  const subscribers = yield* Ref.make(0);
  const pending = new Map<
    string,
    Deferred.Deferred<DesktopCommandResult, DesktopUnavailableError>
  >();

  const request = Effect.fn("DesktopChannel.request")(function* (command: DesktopCommand) {
    if ((yield* Ref.get(subscribers)) === 0)
      return yield* new DesktopUnavailableError({
        reason: "no_desktop",
        detail: "no desktop is connected",
      });
    const id = crypto.randomUUID();
    const done = yield* Deferred.make<DesktopCommandResult, DesktopUnavailableError>();
    pending.set(id, done);
    yield* PubSub.publish(commands, { id, command });
    return yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: COMMAND_TIMEOUT_MS,
        orElse: () =>
          new DesktopUnavailableError({
            reason: "timeout",
            detail: `${command.type} not answered in ${COMMAND_TIMEOUT_MS / 1000}s`,
          }),
      }),
      Effect.ensuring(Effect.sync(() => pending.delete(id))),
    );
  });

  const subscribe = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(commands);
      yield* Ref.update(subscribers, (n) => n + 1);
      yield* Effect.logInfo("desktop connected");
      return Stream.fromSubscription(subscription).pipe(
        Stream.ensuring(
          Ref.update(subscribers, (n) => n - 1).pipe(
            Effect.andThen(Effect.logInfo("desktop disconnected")),
          ),
        ),
      );
    }),
  );

  const complete = Effect.fn("DesktopChannel.complete")(function* (
    completion: DesktopCommandCompletion,
  ) {
    const done = pending.get(completion.id);
    // A completion for an unknown id answers a request that already timed out.
    if (done === undefined) return;
    yield* completion.result === null
      ? Deferred.fail(
          done,
          new DesktopUnavailableError({ reason: "failed", detail: completion.error ?? "" }),
        )
      : Deferred.succeed(done, completion.result);
  });

  return DesktopChannel.of({
    // The desktop answers with the result type of the command it was sent; the cast narrows the union per call.
    request: request as DesktopChannel["Service"]["request"],
    subscribe,
    complete,
    connected: Effect.map(Ref.get(subscribers), (n) => n > 0),
  });
});

export const layer = Layer.effect(DesktopChannel, make);

import {
  DESKTOP_COMMAND_LIMIT_MS,
  type DesktopCommand,
  type DesktopCommandCompletion,
  type DesktopCommandRequest,
  type DesktopCommandResult,
  type DesktopCommandResultFor,
  DesktopUnavailableError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/** Room for the desktop's own "gave up" answer to arrive after its limit ran out. */
const ANSWER_MARGIN_MS = 10_000;

/**
 * The service's one door to the desktop. A connected desktop subscribes to the
 * command stream; `request` sends a command to one desktop and waits for its
 * completion. With no desktop subscribed a request fails at once instead of
 * waiting out the timeout, so compose can fall back without stalling.
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
  const uuids = yield* Crypto.Crypto;
  // Each command goes to the newest desktop only. Broadcast, a session post would run in every
  // desktop on this service (a laptop and a Mac mini, or a reconnect overlapping its old socket).
  const commands = yield* PubSub.unbounded<{
    readonly to: number;
    readonly request: DesktopCommandRequest;
  }>();
  const desktops = yield* Ref.make<ReadonlyArray<number>>([]);
  let nextDesktop = 0;
  const pending = new Map<
    string,
    Deferred.Deferred<DesktopCommandResult, DesktopUnavailableError>
  >();

  const request = Effect.fn("DesktopChannel.request")(function* (command: DesktopCommand) {
    const to = (yield* Ref.get(desktops)).at(-1);
    if (to === undefined)
      return yield* new DesktopUnavailableError({
        reason: "no_desktop",
        detail: "no desktop is connected",
      });
    // A failed random source is a broken platform, not a refusal of this command.
    const id = yield* Effect.orDie(uuids.randomUUIDv4());
    const done = yield* Deferred.make<DesktopCommandResult, DesktopUnavailableError>();
    pending.set(id, done);
    yield* PubSub.publish(commands, { to, request: { id, command } });
    const timeoutMs = DESKTOP_COMMAND_LIMIT_MS[command.type] + ANSWER_MARGIN_MS;
    return yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          new DesktopUnavailableError({
            reason: "timeout",
            detail: `${command.type} not answered in ${timeoutMs / 1000}s`,
          }),
      }),
      Effect.ensuring(Effect.sync(() => pending.delete(id))),
    );
  });

  const subscribe = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(commands);
      const self = nextDesktop++;
      yield* Ref.update(desktops, (all) => [...all, self]);
      yield* Effect.logInfo("desktop connected");
      return Stream.fromSubscription(subscription).pipe(
        Stream.filter((message) => message.to === self),
        Stream.map((message) => message.request),
        Stream.ensuring(
          Ref.update(desktops, (all) => all.filter((d) => d !== self)).pipe(
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
          new DesktopUnavailableError({
            reason: completion.notAttempted === true ? "not_attempted" : "failed",
            detail: completion.error ?? "",
          }),
        )
      : Deferred.succeed(done, completion.result);
  });

  return DesktopChannel.of({
    // The desktop answers with the result type of the command it was sent; the cast narrows the union per call.
    request: request as DesktopChannel["Service"]["request"],
    subscribe,
    complete,
    connected: Effect.map(Ref.get(desktops), (all) => all.length > 0),
  });
});

export const layer = Layer.effect(DesktopChannel, make);

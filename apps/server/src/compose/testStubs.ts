import type { DesktopCommand, DesktopCommandResultFor } from "@xtend/contracts";
import { DesktopUnavailableError } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as DesktopChannel from "../desktop/DesktopChannel.ts";
import * as Articles from "./Articles.ts";

/** An Articles service that dies on use, for tests that only post threads. */
export const articlesStub = Layer.succeed(Articles.Articles)({
  publish: () => Effect.die("articles not stubbed for this test"),
  generateCover: () => Effect.die("articles not stubbed for this test"),
  quote: { articleUsd: 0, coverUsd: 0, coverModel: "stub" },
});

/** A desktop that answers every command through `answer` and records what it was asked. */
export const desktopStub = (
  commands: Array<DesktopCommand>,
  answer: <C extends DesktopCommand>(
    command: C,
  ) => Effect.Effect<DesktopCommandResultFor<C>, DesktopUnavailableError>,
) =>
  Layer.succeed(DesktopChannel.DesktopChannel)({
    request: (command) => {
      commands.push(command);
      return answer(command);
    },
    subscribe: Stream.empty,
    complete: () => Effect.void,
    connected: Effect.succeed(true),
  });

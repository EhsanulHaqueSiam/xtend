import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as Events from "./Events.ts";

describe("Events", () => {
  it.effect("delivers to live subscribers only", () =>
    Effect.gen(function* () {
      const events = yield* Events.Events;
      yield* events.publish({ type: "spend_changed" });
      const collected = yield* events.stream.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
      yield* events.publish({ type: "lead_found", payload: { handle: "levelsio" } });
      const seen = yield* Fiber.join(collected);
      expect(seen.map((e) => e.type)).toEqual(["lead_found"]);
      expect(seen[0]?.payload).toEqual({ handle: "levelsio" });
    }).pipe(Effect.provide(Events.layer)),
  );
});

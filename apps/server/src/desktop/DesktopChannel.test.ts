import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as DesktopChannel from "./DesktopChannel.ts";

describe("DesktopChannel", () => {
  it.effect("fails fast with no desktop connected", () =>
    Effect.gen(function* () {
      const channel = yield* DesktopChannel.DesktopChannel;
      const error = yield* Effect.flip(channel.request({ type: "sessionScreenshot" }));
      expect(error.reason).toBe("no_desktop");
    }).pipe(Effect.provide(DesktopChannel.layer)),
  );

  it.effect("delivers a command to the subscriber and returns its completion", () =>
    Effect.gen(function* () {
      const channel = yield* DesktopChannel.DesktopChannel;
      // A fake desktop: answers the first command it sees and stops.
      const desktop = yield* channel.subscribe.pipe(
        Stream.take(1),
        Stream.runForEach((request) =>
          channel.complete({
            id: request.id,
            result:
              request.command.type === "sessionPost" ? { type: "sessionPost", postId: "42" } : null,
            error: null,
          }),
        ),
        Effect.forkChild,
      );
      // Subscription registers asynchronously; wait until the channel sees it.
      yield* Effect.repeat(channel.connected, { until: (connected) => connected });
      const result = yield* channel.request({ type: "sessionPost", text: "hi", mediaPaths: [] });
      expect(result.postId).toBe("42");
      yield* Fiber.join(desktop);
      yield* Effect.repeat(channel.connected, { until: (connected) => !connected });
    }).pipe(Effect.provide(DesktopChannel.layer)),
  );

  it.effect("maps a null result to a failed request", () =>
    Effect.gen(function* () {
      const channel = yield* DesktopChannel.DesktopChannel;
      yield* channel.subscribe.pipe(
        Stream.take(1),
        Stream.runForEach((request) =>
          channel.complete({ id: request.id, result: null, error: "posting disabled" }),
        ),
        Effect.forkChild,
      );
      yield* Effect.repeat(channel.connected, { until: (connected) => connected });
      const error = yield* Effect.flip(channel.request({ type: "sessionScreenshot" }));
      expect(error.reason).toBe("failed");
      expect(error.detail).toBe("posting disabled");
    }).pipe(Effect.provide(DesktopChannel.layer)),
  );
});

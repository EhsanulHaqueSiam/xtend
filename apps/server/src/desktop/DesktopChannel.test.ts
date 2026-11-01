import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { DESKTOP_COMMAND_LIMIT_MS, type DesktopCommandRequest } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopChannel from "./DesktopChannel.ts";

const layerTest = DesktopChannel.layer.pipe(Layer.provide(NodeCrypto.layer));

describe("DesktopChannel", () => {
  it.effect("fails fast with no desktop connected", () =>
    Effect.gen(function* () {
      const channel = yield* DesktopChannel.DesktopChannel;
      const error = yield* Effect.flip(channel.request({ type: "sessionScreenshot" }));
      expect(error.reason).toBe("no_desktop");
    }).pipe(Effect.provide(layerTest)),
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
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("sends each command to the newest desktop only, so two desktops never both post", () =>
    Effect.gen(function* () {
      const channel = yield* DesktopChannel.DesktopChannel;
      const seenByOld: Array<string> = [];
      // A fake desktop that answers every command with its own name.
      const desktop = (name: string, seen: Array<string>) =>
        channel.subscribe.pipe(
          Stream.runForEach((request) => {
            seen.push(request.command.type);
            return channel.complete({
              id: request.id,
              result:
                request.command.type === "sessionPost"
                  ? { type: "sessionPost", postId: name }
                  : { type: "sessionScreenshot", pngBase64: name },
              error: null,
            });
          }),
          Effect.forkChild,
        );
      const answeredBy = Effect.map(
        channel.request({ type: "sessionScreenshot" }),
        (r) => r.pngBase64,
      );

      yield* desktop("1", seenByOld);
      yield* Effect.repeat(channel.connected, { until: (connected) => connected });
      const newer = yield* desktop("2", []);
      // Screenshots reach the old desktop until the new one has registered.
      yield* Effect.repeat(answeredBy, { until: (by) => by === "2" });
      const posted = yield* channel.request({ type: "sessionPost", text: "hi", mediaPaths: [] });
      expect(posted.postId).toBe("2");

      // With the new desktop gone the old one answers again, and it never saw the post.
      yield* Fiber.interrupt(newer);
      expect(yield* answeredBy).toBe("1");
      expect(seenByOld).not.toContain("sessionPost");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "waits out the desktop's own limit per command, so a slow video post is not cut short",
    () =>
      Effect.gen(function* () {
        const channel = yield* DesktopChannel.DesktopChannel;
        const received = yield* Queue.unbounded<DesktopCommandRequest>();
        yield* channel.subscribe.pipe(
          Stream.runForEach((request) => Queue.offer(received, request)),
          Effect.forkChild,
        );
        yield* Effect.repeat(channel.connected, { until: (connected) => connected });

        const post = yield* channel
          .request({ type: "sessionPost", text: "hi", mediaPaths: ["/tmp/clip.mp4"] })
          .pipe(Effect.forkChild);
        const { id } = yield* Queue.take(received);
        // The whole of the desktop's limit for a post goes by while the video uploads.
        yield* TestClock.adjust(DESKTOP_COMMAND_LIMIT_MS.sessionPost);
        yield* channel.complete({ id, result: { type: "sessionPost", postId: "42" }, error: null });
        expect((yield* Fiber.join(post)).postId).toBe("42");

        // A screenshot the desktop never answers gives up long before that.
        const shot = yield* channel
          .request({ type: "sessionScreenshot" })
          .pipe(Effect.flip, Effect.forkChild);
        yield* Queue.take(received);
        yield* TestClock.adjust(DESKTOP_COMMAND_LIMIT_MS.sessionScreenshot + 10_000);
        expect((yield* Fiber.join(shot)).reason).toBe("timeout");
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "maps a null result to a failed request, or not attempted when the desktop says so",
    () =>
      Effect.gen(function* () {
        const channel = yield* DesktopChannel.DesktopChannel;
        // The first command fails after the desktop touched the page; the second it refused untouched.
        yield* channel.subscribe.pipe(
          Stream.take(2),
          Stream.zipWithIndex,
          Stream.runForEach(([request, i]) =>
            channel.complete(
              i === 0
                ? { id: request.id, result: null, error: "x.com did not confirm the post" }
                : { id: request.id, result: null, error: "posting disabled", notAttempted: true },
            ),
          ),
          Effect.forkChild,
        );
        yield* Effect.repeat(channel.connected, { until: (connected) => connected });
        const post = { type: "sessionPost", text: "hi", mediaPaths: [] } as const;
        const failed = yield* Effect.flip(channel.request(post));
        expect([failed.reason, failed.detail]).toEqual([
          "failed",
          "x.com did not confirm the post",
        ]);
        const refused = yield* Effect.flip(channel.request(post));
        expect([refused.reason, refused.detail]).toEqual(["not_attempted", "posting disabled"]);
      }).pipe(Effect.provide(layerTest)),
  );
});

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as ThreadStore from "./ThreadStore.ts";

const layerTest = ThreadStore.layer.pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(NodeServices.layer),
);

describe("ThreadStore", () => {
  it.effect("replays history then delivers live appends without gaps or repeats", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore.ThreadStore;
      const thread = yield* store.create("test");
      yield* store.append(thread.threadId, { type: "user_message", text: "one" });
      yield* store.append(thread.threadId, { type: "turn_started" });

      const collector = yield* store
        .subscribe(thread.threadId, 0)
        .pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* store.append(thread.threadId, { type: "assistant_text", text: "hi" });
      yield* store.append(thread.threadId, {
        type: "turn_finished",
        ok: true,
        error: null,
        costUsd: 0.01,
      });

      const records = yield* Fiber.join(collector);
      expect(records.map((r) => r.event.type)).toEqual([
        "user_message",
        "turn_started",
        "assistant_text",
        "turn_finished",
      ]);
      expect(records.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("resumes from a sequence and ignores other threads", () =>
    Effect.gen(function* () {
      const store = yield* ThreadStore.ThreadStore;
      const a = yield* store.create("a");
      const b = yield* store.create("b");
      yield* store.append(a.threadId, { type: "user_message", text: "a1" });
      yield* store.append(b.threadId, { type: "user_message", text: "b1" });
      yield* store.append(a.threadId, { type: "user_message", text: "a2" });

      const after = yield* store.events(a.threadId, 1);
      expect(after.map((r) => r.event)).toEqual([{ type: "user_message", text: "a2" }]);
      const list = yield* store.list;
      expect(list.map((t) => t.title)).toEqual(["a", "b"]);
    }).pipe(Effect.provide(layerTest)),
  );
});

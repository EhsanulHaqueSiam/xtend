// @effect-diagnostics nodeBuiltinImport:off -- stands in for the raw stdin pipe the desktop holds.
import { PassThrough } from "node:stream";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { ServiceSupervisor } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command } from "effect/cli";

import { cli, stopWithDesktop } from "./binCli.ts";
import * as Api from "./cli/api.ts";

const stub = (answer: (method: string) => unknown) => {
  const calls: Array<[string, unknown]> = [];
  const layer = Layer.succeed(Api.Api)({
    url: "http://stub",
    call: (method, payload) => {
      calls.push([method, payload]);
      return Effect.succeed(answer(method));
    },
  });
  return { calls, layer };
};

const run = (args: ReadonlyArray<string>, api: Layer.Layer<Api.Api>) =>
  Command.runWith(cli, { version: "test" })(args).pipe(
    Effect.provide(Layer.mergeAll(api, NodeServices.layer)),
  );

describe("xtend cli", () => {
  it.effect("post creates a draft from the argument and posts it", () =>
    Effect.gen(function* () {
      const api = stub(() => ({ id: "d1", status: "posted", postIds: ["1"], blocks: [] }));
      yield* run(["post", "hello world"], api.layer);
      expect(api.calls).toEqual([
        ["compose.draftCreate", { blocks: [{ text: "hello world" }] }],
        ["compose.postNow", { id: "d1" }],
      ]);
    }),
  );

  it.effect("post fails the command when the draft did not go out", () =>
    Effect.gen(function* () {
      const api = stub((method) =>
        method === "compose.draftCreate"
          ? { id: "d1", status: "draft", postIds: [], blocks: [] }
          : { id: "d1", status: "failed", postIds: [], blocks: [], error: "budget reached" },
      );
      const error = yield* Effect.flip(run(["post", "hello"], api.layer));
      expect(error).toMatchObject({ _tag: "ApiError", detail: "failed: budget reached" });
    }),
  );

  it.effect("agents run resolves the name through the agent list", () =>
    Effect.gen(function* () {
      const api = stub((method) =>
        method === "leads.agentsList"
          ? [{ id: 7, name: "founders" }]
          : { found: 1, inserted: 1, costUsd: 0, error: null },
      );
      yield* run(["agents", "run", "founders"], api.layer);
      expect(api.calls[1]).toEqual(["leads.agentRun", { id: 7 }]);
    }),
  );

  it.live(
    "a desktop's child stops once the desktop's end of its stdin closes; launchd and shell runs never",
    () =>
      Effect.gen(function* () {
        const stopped: Array<ServiceSupervisor> = [];
        const closeStdin = (supervisor: ServiceSupervisor) =>
          Effect.gen(function* () {
            const stdin = new PassThrough();
            // Stands in for runServer: serves until interrupted, then closes what it opened.
            const server = Effect.never.pipe(
              Effect.onInterrupt(() => Effect.sync(() => stopped.push(supervisor))),
            );
            const fiber = yield* server.pipe(
              stopWithDesktop(supervisor, stdin),
              Effect.forkChild({ startImmediately: true }),
            );
            stdin.end();
            return yield* Fiber.join(fiber).pipe(Effect.timeoutOption("200 millis"));
          });

        expect(Option.isSome(yield* closeStdin("child"))).toBe(true);
        expect(stopped).toEqual(["child"]);
        expect(Option.isNone(yield* closeStdin("launchd"))).toBe(true);
        expect(Option.isNone(yield* closeStdin("none"))).toBe(true);
        expect(stopped).toEqual(["child"]);
      }),
  );
});

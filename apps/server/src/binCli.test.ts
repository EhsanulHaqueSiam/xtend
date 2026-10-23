import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/cli";

import { cli } from "./binCli.ts";
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
});

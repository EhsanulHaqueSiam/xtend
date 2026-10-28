import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import * as Budget from "../budget/Budget.ts";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Assist from "./Assist.ts";

// The real SDK spawns a model run; this one answers with one result message per call.
const sdk = vi.hoisted(() => ({
  query: vi.fn((_input: { readonly prompt: string }) =>
    (async function* () {
      yield {
        type: "result",
        is_error: false,
        total_cost_usd: 0.02,
        structured_output: { hook: "Ship it" },
      };
    })(),
  ),
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);

// The user's own endpoint: records what it was sent and answers like an OpenAI-compatible server,
// in the fences models tend to add.
const ownCalls: Array<HttpClientRequest.HttpClientRequest> = [];
const ownModel = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) => {
    ownCalls.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"hook":"Local hook"}\n```' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
  }),
);

const layerTest = Assist.layer.pipe(
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      ownModel,
      TokenCipher.layerTest,
      ServerConfig.layer({
        version: "test",
        port: 0,
        host: "127.0.0.1",
        baseDir: "/nonexistent",
        dbPath: ":memory:",
        staticDir: undefined,
        devUrl: undefined,
        supervisor: "none",
      }),
    ),
  ),
);

const request = {
  task: "compose.improveHook",
  instructions: "Improve the hook.",
  input: { text: "draft" },
  output: Schema.Struct({ hook: Schema.String }),
};

describe("Assist.generate", () => {
  it.effect("returns the structured answer and logs what the model run cost", () =>
    Effect.gen(function* () {
      sdk.query.mockClear();
      const assist = yield* Assist.Assist;
      const settings = yield* SettingsStore.SettingsStore;
      expect(yield* assist.generate(request)).toEqual({ hook: "Ship it" });
      const spend = yield* settings.spendSummary;
      expect(spend.byPurpose).toEqual([{ purpose: "compose.improveHook", costUsd: 0.02 }]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("starts no model run when the budget refuses the reservation", () =>
    Effect.gen(function* () {
      sdk.query.mockClear();
      const assist = yield* Assist.Assist;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ monthlyBudgetUsd: 0.01 });
      const error = yield* Effect.flip(assist.generate(request));
      expect(error.reason).toBe("budget");
      expect(sdk.query).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("Assist.generate with the user's own model", () => {
  it.effect("asks the user's endpoint instead of the SDK, with the key, and pays nothing", () =>
    Effect.gen(function* () {
      sdk.query.mockClear();
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({
        assistBaseUrl: "http://127.0.0.1:11434/v1/",
        assistModel: "llama3.1",
        assistKey: "sk-own",
      });
      const assist = yield* Assist.Assist;
      expect(yield* assist.generate(request)).toEqual({ hook: "Local hook" });
      expect(sdk.query).not.toHaveBeenCalled();
      const [sent] = ownCalls;
      expect(sent?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
      expect(sent?.headers.authorization).toBe("Bearer sk-own");
      expect((yield* settings.spendSummary).recent).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("Assist settings", () => {
  it.effect(
    "drops the key when the endpoint changes without a new one, and refuses non-model hosts",
    () =>
      Effect.gen(function* () {
        const settings = yield* SettingsStore.SettingsStore;
        yield* settings.update({ assistBaseUrl: "https://api.openai.com/v1", assistKey: "sk-a" });
        expect((yield* settings.get).assistKeySet).toBe(true);
        const moved = yield* settings.update({ assistBaseUrl: "http://169.254.169.254/v1" });
        expect(moved.assistKeySet).toBe(false);
        const assist = yield* Assist.Assist;
        const refused = yield* assist.generate(request).pipe(Effect.flip);
        expect(refused.detail).toContain("not a model host");
      }).pipe(Effect.provide(layerTest)),
  );
});

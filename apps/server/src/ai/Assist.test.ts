import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
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

const layerTest = Assist.layer.pipe(
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
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

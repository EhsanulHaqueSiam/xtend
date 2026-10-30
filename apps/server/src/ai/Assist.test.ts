// @effect-diagnostics nodeBuiltinImport:off -- a real executable on disk stands in for the CLI.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Assist from "./Assist.ts";

// A stand-in Claude CLI: logs each call's arguments and stdin, then answers like
// `claude -p --output-format json`. \x1f ends an argument, \x1e a call.
const fakeDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-fake-claude-"));
const fakeClaude = NodePath.join(fakeDir, "claude");
const fakeLog = NodePath.join(fakeDir, "calls.log");
NodeFS.writeFileSync(
  fakeClaude,
  `#!/bin/sh
printf '%s\\037' "$@" >> "${fakeLog}"
cat >> "${fakeLog}"
printf '\\036' >> "${fakeLog}"
echo '{"type":"result","is_error":false,"result":"","structured_output":{"hook":"Ship it"}}'
`,
  { mode: 0o755 },
);
/** Each call as its arguments and the prompt it read on stdin. */
const calls = () =>
  (NodeFS.existsSync(fakeLog) ? NodeFS.readFileSync(fakeLog, "utf8").split("\x1e") : [])
    .slice(0, -1)
    .map((call) => {
      const parts = call.split("\x1f");
      return { args: parts.slice(0, -1), prompt: parts.at(-1)! };
    });

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
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      NodeServices.layer,
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
  it.effect("runs the user's Claude command with the chosen model, and logs no spend", () =>
    Effect.gen(function* () {
      NodeFS.rmSync(fakeLog, { force: true });
      const assist = yield* Assist.Assist;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({
        assistModel: "test-model",
        assistBinaryPath: fakeClaude,
        monthlyBudgetUsd: 0,
      });
      expect(yield* assist.generate(request)).toEqual({ hook: "Ship it" });
      const { args } = calls()[0]!;
      expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
        "--model",
        "test-model",
      ]);
      expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
        "--tools",
        "",
      ]);
      const spend = yield* settings.spendSummary;
      expect(spend.byPurpose).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("puts the picked tone after the instructions, and nothing without one", () =>
    Effect.gen(function* () {
      NodeFS.rmSync(fakeLog, { force: true });
      const assist = yield* Assist.Assist;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ assistBinaryPath: fakeClaude });
      yield* assist.generate(request);
      yield* assist.generate({ ...request, tone: "sarcastic" });
      const prompts = calls().map((c) => c.prompt.split("\n")[0]);
      expect(prompts).toEqual([
        "Improve the hook.",
        "Improve the hook. Every option is dry and sarcastic, without insulting anyone.",
      ]);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("Assist.generate with the user's own model", () => {
  it.effect("asks the user's endpoint instead of a CLI, with the key, and pays nothing", () =>
    Effect.gen(function* () {
      NodeFS.rmSync(fakeLog, { force: true });
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({
        assistProvider: "endpoint",
        assistBaseUrl: "http://127.0.0.1:11434/v1/",
        assistModel: "llama3.1",
        assistKey: "sk-own",
      });
      const assist = yield* Assist.Assist;
      expect(yield* assist.generate(request)).toEqual({ hook: "Local hook" });
      expect(calls()).toEqual([]);
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
        const moved = yield* settings.update({
          assistProvider: "endpoint",
          assistBaseUrl: "http://169.254.169.254/v1",
        });
        expect(moved.assistKeySet).toBe(false);
        const assist = yield* Assist.Assist;
        const refused = yield* assist.generate(request).pipe(Effect.flip);
        expect(refused.detail).toContain("not a model host");
      }).pipe(Effect.provide(layerTest)),
  );
});

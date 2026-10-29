import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import * as Codex from "./Codex.ts";
import * as OwnModel from "./OwnModel.ts";
import * as ServerConfig from "../config.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

export class AssistError extends Schema.TaggedError<AssistError>()("AssistError", {
  task: Schema.String,
  reason: Schema.Literals(["model", "decode"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Assist "${this.task}" failed (${this.reason}): ${this.detail}`;
  }
}

export interface AssistRequest<A> {
  /** Short name for the spend log and errors, e.g. "compose.improveHook". */
  readonly task: string;
  /** What to do. The user's voice notes and keywords are appended automatically. */
  readonly instructions: string;
  /** Anything the model should look at: the draft, the posts, the trends. Serialized as JSON. */
  readonly input: unknown;
  /** Shape of the answer. The model is forced to return exactly this. */
  readonly output: Schema.Codec<A>;
}

const BASE_PROMPT = `You are the writing and research assistant inside Xtend, a desktop app for growing on X (Twitter).
You never post, like, follow or message anyone yourself; you produce text and judgements the app shows to the user.
Write like a sharp human operator, not a marketer: concrete, specific, no hashtags unless asked, no emoji unless the
user's own posts use them, no em dashes. Hooks are the first line and must create tension or a specific claim.
Respect X limits: 280 characters per post unless told the account is Premium.`;

/**
 * One structured model call on the user's own login (Claude or Codex, as T3 Code runs them) or
 * their own endpoint. Screens pass an instruction and a schema; they never see the provider.
 */
export class Assist extends Context.Service<
  Assist,
  { readonly generate: <A>(request: AssistRequest<A>) => Effect.Effect<A, AssistError> }
>()("xtend/ai/Assist") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* SettingsStore.SettingsStore;
  const http = yield* HttpClient.HttpClient;
  // The Codex CLI runs through the platform services the service already has.
  const platform = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();

  const generate = Effect.fn("Assist.generate")(function* <A>(request: AssistRequest<A>) {
    const current = yield* settings.get.pipe(Effect.orElseSucceed(() => null));
    const voice =
      current === null
        ? ""
        : `\n\nAbout the user's account: ${current.voiceNotes || "(no notes yet)"}\nTheir niche keywords: ${current.keywords.join(", ") || "(none yet)"}`;
    const jsonSchema = Schema.toJsonSchemaDocument(request.output).schema;
    const prompt = `${request.instructions}\n\nInput:\n${encodeJson(request.input)}`;
    const decode = (output: unknown) =>
      Schema.decodeUnknownEffect(request.output)(output).pipe(
        Effect.mapError(
          (e) =>
            new AssistError({
              task: request.task,
              reason: "decode",
              detail: String(e).slice(0, 300),
            }),
        ),
      );

    const modelError = (e: unknown) =>
      new AssistError({
        task: request.task,
        reason: "model",
        detail: typeof e === "string" ? e : String(e).slice(0, 300),
      });
    const system = BASE_PROMPT + voice;
    const provider = current?.assistProvider ?? "claude";
    const model = current?.assistModel ?? "";

    // Every provider is the user's own: nothing here reserves budget or writes the spend log.
    if (provider === "endpoint") {
      if (current === null || current.assistBaseUrl === null)
        return yield* modelError("Set an endpoint in Settings, Writing.");
      const key = yield* settings.assistKey.pipe(Effect.orElseSucceed(() => null));
      const output = yield* OwnModel.complete({
        baseUrl: current.assistBaseUrl,
        model,
        key,
        system,
        prompt,
        jsonSchema,
      }).pipe(Effect.provideService(HttpClient.HttpClient, http), Effect.mapError(modelError));
      return yield* decode(output);
    }

    if (provider === "codex") {
      const output = yield* Codex.complete({ model, system, prompt, jsonSchema }).pipe(
        Effect.provide(platform),
        Effect.mapError(modelError),
      );
      return yield* decode(output);
    }

    // Loaded on the first model call, not at start: the packaged app and the CLI ship without
    // the SDK's per-platform binaries, and everything but assist must still run there.
    const sdk = yield* Effect.tryPromise({
      try: () => import("@anthropic-ai/claude-agent-sdk"),
      catch: () => modelError("AI assist is not included in this build of Xtend."),
    });
    let output: unknown = undefined;
    let error: string | null = null;
    yield* Stream.fromAsyncIterable(
      sdk.query({
        prompt,
        options: {
          cwd: config.baseDir,
          systemPrompt: system,
          ...(model === "" ? {} : { model }),
          tools: [],
          allowedTools: [],
          settingSources: [],
          permissionMode: "default",
          maxTurns: 1,
          outputFormat: { type: "json_schema", schema: jsonSchema as Record<string, unknown> },
        },
      }),
      (cause) => cause,
    ).pipe(
      Stream.runForEach((message: SDKMessage) =>
        Effect.sync(() => {
          if (message.type !== "result") return;
          if (message.is_error) {
            error =
              "errors" in message && message.errors.length > 0
                ? message.errors.join("; ")
                : message.subtype;
          } else {
            output = (message as { structured_output?: unknown }).structured_output;
          }
        }),
      ),
      Effect.catch((cause) =>
        Effect.sync(() => {
          error ??= String(cause).slice(0, 300);
        }),
      ),
    );

    if (error !== null)
      return yield* new AssistError({ task: request.task, reason: "model", detail: error });
    return yield* decode(output);
  });

  return Assist.of({ generate });
});

export const layer = Layer.effect(Assist, make);

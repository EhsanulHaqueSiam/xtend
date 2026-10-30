import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import type * as Path from "effect/Path";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Schema from "effect/Schema";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import type { ReplyTone } from "@xtend/contracts";

import * as Claude from "./Claude.ts";
import * as Codex from "./Codex.ts";
import { loginPath } from "./loginPath.ts";
import * as OwnModel from "./OwnModel.ts";
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
  /** The taste the user picked in a chooser; every option the model writes takes it. */
  readonly tone?: ReplyTone | undefined;
}

/** How each tone in the chooser reads to the model, after "Every option". */
const TONES: Record<ReplyTone, string> = {
  fit: "is the kind of reply this topic calls for (an added point, a question, a pushback, a joke, warmth), judged from the post itself; the options may differ in kind",
  mine: "sounds like the user wrote it: their length, rhythm, attitude and words, from their voice notes and any of their own posts in the input",
  agree: "agrees with the author and says why from the user's own experience",
  add: "adds a point, example or number the author left out",
  ask: "asks one specific question the author would want to answer",
  contrarian: "pushes back on the claim with a reason",
  sarcastic: "is dry and sarcastic, without insulting anyone",
  warm: "is warm and personal, like talking to a friend",
  short: "is one short sentence",
};

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
  const settings = yield* SettingsStore.SettingsStore;
  const http = yield* HttpClient.HttpClient;
  // The CLIs run through the platform services the service already has.
  const platform = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();
  // Read once, on the first CLI call: the login shell is slow and its PATH rarely moves.
  const path = yield* Effect.cached(loginPath.pipe(Effect.provide(platform)));

  const generate = Effect.fn("Assist.generate")(function* <A>(request: AssistRequest<A>) {
    const current = yield* settings.get.pipe(Effect.orElseSucceed(() => null));
    const voice =
      current === null
        ? ""
        : `\n\nAbout the user's account: ${current.voiceNotes || "(no notes yet)"}\nTheir niche keywords: ${current.keywords.join(", ") || "(none yet)"}`;
    const jsonSchema = Schema.toJsonSchemaDocument(request.output).schema;
    const tone = request.tone === undefined ? "" : ` Every option ${TONES[request.tone]}.`;
    const prompt = `${request.instructions}${tone}\n\nInput:\n${encodeJson(request.input)}`;
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

    const binary = current?.assistBinaryPath || provider;
    const output = yield* (
      provider === "codex"
        ? Codex.complete({ binary, path: yield* path, model, system, prompt, jsonSchema })
        : Claude.complete({ binary, path: yield* path, model, system, prompt, jsonSchema })
    ).pipe(Effect.provide(platform), Effect.mapError(modelError));
    return yield* decode(output);
  });

  return Assist.of({ generate });
});

export const layer = Layer.effect(Assist, make);

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import * as Budget from "../budget/Budget.ts";
import * as ServerConfig from "../config.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

/** Reserved before every model call; one structured call lands well under this and the actual cost settles it. */
export const EXPECTED_CALL_USD = 0.05;

export class AssistError extends Schema.TaggedError<AssistError>()("AssistError", {
  task: Schema.String,
  reason: Schema.Literals(["model", "decode", "budget"]),
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
 * One structured call to Claude. Screens call this with a task-specific
 * instruction and a schema; they never see the model, prompts or the SDK.
 */
export class Assist extends Context.Service<
  Assist,
  { readonly generate: <A>(request: AssistRequest<A>) => Effect.Effect<A, AssistError> }
>()("xtend/ai/Assist") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* SettingsStore.SettingsStore;
  const budget = yield* Budget.Budget;

  const generate = Effect.fn("Assist.generate")(function* <A>(request: AssistRequest<A>) {
    const current = yield* settings.get.pipe(Effect.orElseSucceed(() => null));
    const voice =
      current === null
        ? ""
        : `\n\nAbout the user's account: ${current.voiceNotes || "(no notes yet)"}\nTheir niche keywords: ${current.keywords.join(", ") || "(none yet)"}`;
    const jsonSchema = Schema.toJsonSchemaDocument(request.output).schema;
    const prompt = `${request.instructions}\n\nInput:\n${encodeJson(request.input)}`;

    // Loaded on the first model call, not at start: the packaged app and the CLI ship without
    // the SDK's per-platform binaries, and everything but assist must still run there.
    const sdk = yield* Effect.tryPromise({
      try: () => import("@anthropic-ai/claude-agent-sdk"),
      catch: () =>
        new AssistError({
          task: request.task,
          reason: "model",
          detail: "AI assist is not included in this build of Xtend.",
        }),
    });
    let output: unknown = undefined;
    let error: string | null = null;
    let costUsd = 0;
    // `query` spawns the model and sends the prompt at once, so it is called inside the budget's
    // body: a refused reservation must not start a paid run.
    const run = Stream.suspend(() =>
      Stream.fromAsyncIterable(
        sdk.query({
          prompt,
          options: {
            cwd: config.baseDir,
            systemPrompt: BASE_PROMPT + voice,
            tools: [],
            allowedTools: [],
            settingSources: [],
            permissionMode: "default",
            maxTurns: 1,
            outputFormat: { type: "json_schema", schema: jsonSchema as Record<string, unknown> },
          },
        }),
        (cause) => cause,
      ),
    );
    const consume = run.pipe(
      Stream.runForEach((message: SDKMessage) =>
        Effect.sync(() => {
          if (message.type !== "result") return;
          costUsd = message.total_cost_usd ?? 0;
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
      Effect.map(() => ({ value: undefined, costUsd })),
    );
    yield* budget
      .spend(
        {
          expectedUsd: EXPECTED_CALL_USD,
          provider: "claude",
          endpoint: "agent-sdk",
          purpose: request.task,
        },
        consume,
      )
      .pipe(
        Effect.catchTag("BudgetExceeded", (e) =>
          Effect.fail(new AssistError({ task: request.task, reason: "budget", detail: e.message })),
        ),
      );

    if (error !== null)
      return yield* new AssistError({ task: request.task, reason: "model", detail: error });
    return yield* Schema.decodeUnknownEffect(request.output)(output).pipe(
      Effect.mapError(
        (e) =>
          new AssistError({
            task: request.task,
            reason: "decode",
            detail: String(e).slice(0, 300),
          }),
      ),
    );
  });

  return Assist.of({ generate });
});

export const layer = Layer.effect(Assist, make);

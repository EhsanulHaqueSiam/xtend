import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Schema from "effect/Schema";

/** The one shape every OpenAI-compatible server answers with; nothing else is read. */
const Completion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) }),
  ),
});
const decodeCompletion = Schema.decodeUnknownEffect(Schema.fromJsonString(Completion));
const json = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeSync(json);
const decodeJson = Schema.decodeUnknownEffect(json);

/** Models answer in fences more often than not, whatever the format asked for. */
const unfence = (text: string) =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

/**
 * One structured call to the user's own OpenAI-compatible endpoint: a local Ollama, or their
 * key at OpenAI, Anthropic, Groq or OpenRouter. The schema travels both as `response_format`
 * and in the system prompt, since not every server honours the first. Costs the user nothing
 * through Xtend; the caller decodes the JSON against the task's schema.
 */
export const complete = Effect.fn("OwnModel.complete")(function* (input: {
  readonly baseUrl: string;
  readonly model: string;
  readonly key: string | null;
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: unknown;
}) {
  const http = yield* HttpClient.HttpClient;
  const url = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const request = HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeaders({
      Accept: "application/json",
      ...(input.key === null ? {} : { Authorization: `Bearer ${input.key}` }),
    }),
    (r) =>
      HttpClientRequest.bodyJsonUnsafe(r, {
        model: input.model,
        stream: false,
        messages: [
          {
            role: "system",
            content: `${input.system}\n\nAnswer with one JSON object and nothing else, matching this JSON Schema:\n${encodeJson(input.jsonSchema)}`,
          },
          { role: "user", content: input.prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "output", schema: input.jsonSchema },
        },
      }),
  );
  const response = yield* http.execute(request);
  const text = yield* response.text;
  if (response.status >= 400)
    return yield* Effect.fail(`${input.model} at ${url}: ${response.status} ${text.slice(0, 200)}`);
  const completion = yield* decodeCompletion(text).pipe(
    Effect.mapError(() => `${url} answered something that is not a chat completion`),
  );
  const content = completion.choices[0]?.message.content;
  if (content == null) return yield* Effect.fail(`${input.model} answered with no content`);
  return yield* decodeJson(unfence(content)).pipe(
    Effect.mapError(() => `${input.model} did not answer with JSON`),
  );
});

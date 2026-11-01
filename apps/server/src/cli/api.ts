import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient } from "effect/http";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** The CLI and MCP server reach the running service only through `POST /api/rpc/<method>`. */
export class Api extends Context.Service<
  Api,
  {
    readonly url: string;
    readonly call: (method: string, payload: unknown) => Effect.Effect<unknown, ApiError>;
  }
>()("xtend/cli/api") {}

/** The service writes its token on first start; sharing the base dir is how a caller is trusted. */
export const readToken = Effect.fn("Api.readToken")(function* (baseDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const override = process.env.XTEND_SERVICE_TOKEN;
  if (override !== undefined && override !== "") return override;
  return yield* fs.readFileString(path.join(baseDir, "auth-token")).pipe(
    Effect.map((s) => s.trim()),
    Effect.mapError(
      () =>
        new ApiError({
          detail: `no service token in ${baseDir}; start Xtend once or run \`xtend service install\``,
        }),
    ),
  );
});

export const layer = (options: { readonly url: string; readonly token: string }) =>
  Layer.effect(
    Api,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const call = Effect.fn("Api.call")(function* (method: string, payload: unknown) {
        const response = yield* http
          .post(new URL(`/api/rpc/${method}`, options.url), {
            headers: { authorization: `Bearer ${options.token}` },
            body: HttpBody.jsonUnsafe(payload),
          })
          .pipe(
            Effect.mapError(
              () =>
                new ApiError({
                  detail: `no service at ${options.url}; start Xtend or run \`xtend service install\``,
                }),
            ),
          );
        const badAnswer = () => new ApiError({ detail: `bad answer from ${method}` });
        const text = yield* response.text.pipe(Effect.mapError(badAnswer));
        // Errors are read as text: the auth guard answers a plain "unauthorized", not JSON.
        if (response.status !== 200)
          return yield* new ApiError({
            detail: `${method} failed (${response.status}): ${text.slice(0, 500)}`,
          });
        return yield* decodeJson(text).pipe(Effect.mapError(badAnswer));
      });
      return Api.of({ url: options.url, call });
    }),
  );

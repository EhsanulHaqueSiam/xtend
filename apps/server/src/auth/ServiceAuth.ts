// @effect-diagnostics nodeBuiltinImport:off -- token generation needs the platform's CSPRNG.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerConfig from "../config.ts";

const TOKEN_FILE = "auth-token";

/**
 * Bearer auth for every mutating surface. The token lives in the base dir,
 * so whoever can read that directory (the desktop, a CLI, the user) can
 * talk to the service and a stray web page cannot. Origin is checked too:
 * a page served from anywhere but the dev server or the service itself is
 * refused even with a leaked token.
 */
export class ServiceAuth extends Context.Service<
  ServiceAuth,
  {
    readonly token: string;
    readonly allows: (request: HttpServerRequest.HttpServerRequest) => boolean;
    readonly isAllowedOrigin: (origin: string | undefined) => boolean;
  }
>()("xtend/auth/ServiceAuth") {}

export const make = (options: {
  readonly token: string;
  readonly allowedOrigins: ReadonlySet<string>;
}): ServiceAuth["Service"] => {
  // Non-browser callers (the desktop's capture pipeline, curl) send no Origin; the token is their proof.
  const isAllowedOrigin = (origin: string | undefined) =>
    origin === undefined || options.allowedOrigins.has(origin);
  const presented = (request: HttpServerRequest.HttpServerRequest) => {
    const header = request.headers["authorization"];
    if (header !== undefined && header.startsWith("Bearer ")) return header.slice(7);
    return new URL(request.url, "http://x").searchParams.get("token") ?? undefined;
  };
  const allows = (request: HttpServerRequest.HttpServerRequest) => {
    const token = presented(request);
    return (
      token !== undefined &&
      token.length === options.token.length &&
      NodeCrypto.timingSafeEqual(Buffer.from(token), Buffer.from(options.token)) &&
      isAllowedOrigin(request.headers["origin"])
    );
  };
  return { token: options.token, allows, isAllowedOrigin };
};

/** Refuses the request with 401 unless it carries the token from an allowed origin. */
export const guarded = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | ServiceAuth | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const auth = yield* ServiceAuth;
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!auth.allows(request)) return HttpServerResponse.text("unauthorized", { status: 401 });
    return yield* handler;
  });

export const layer = Layer.effect(
  ServiceAuth,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(config.baseDir, TOKEN_FILE);
    yield* fs.makeDirectory(config.baseDir, { recursive: true });
    const existing = yield* fs
      .readFileString(file)
      .pipe(Effect.map((s) => s.trim()), Effect.orElseSucceed(() => ""));
    const token = existing !== "" ? existing : NodeCrypto.randomBytes(32).toString("hex");
    if (existing === "") {
      yield* fs.writeFileString(file, token + "\n", { mode: 0o600 });
      yield* Effect.log("Generated service auth token").pipe(Effect.annotateLogs({ file }));
    }
    const own = [`http://${config.host}:${config.port}`, `http://127.0.0.1:${config.port}`];
    const allowedOrigins = new Set([
      ...own,
      `http://localhost:${config.port}`,
      ...(config.devUrl === undefined ? [] : [config.devUrl.origin]),
    ]);
    return make({ token, allowedOrigins });
  }),
);

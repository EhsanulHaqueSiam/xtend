import { ObservationBatch } from "@xtend/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import * as ServiceAuth from "./auth/ServiceAuth.ts";
import * as RuleStore from "./automate/RuleStore.ts";
import * as Webhooks from "./automate/Webhooks.ts";
import * as ServerConfig from "./config.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";

/** Name of the meta tag the packaged web app reads its token from. */
const TOKEN_META = "xtend-token";

export const layerHealthRoute = HttpRouter.add(
  "GET",
  "/api/health",
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return yield* HttpServerResponse.json({ name: "xtend", version: config.version });
  }),
);

/**
 * The desktop's capture pipeline posts here. Plain HTTP keeps the Electron main
 * process free of an RPC client; the body is the same schema the RPC uses.
 */
export const layerObservationsRoute = HttpRouter.add(
  "POST",
  "/api/observations",
  ServiceAuth.guarded(
    Effect.gen(function* () {
      const batch = yield* HttpServerRequest.schemaBodyJson(ObservationBatch);
      const store = yield* ObservationStore.ObservationStore;
      const result = yield* store.record(batch);
      return yield* HttpServerResponse.json(result);
    }).pipe(
      Effect.catchTags({
        SchemaError: (error) =>
          HttpServerResponse.json(
            { error: "invalid_batch", message: error.message },
            { status: 400 },
          ),
        ObservationStoreError: (error) =>
          HttpServerResponse.json({ error: error._tag, message: error.message }, { status: 500 }),
      }),
    ),
  ),
);

/**
 * Hands the token to the Vite dev server's page and nobody else: the route only
 * exists when a dev URL is configured and only answers that origin. POST because
 * browsers always send Origin on POST and may omit it on same-origin GET.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A browser on this machine that addressed the service by a loopback name.
 * The Host check defeats DNS rebinding: a page at evil.example resolving to
 * 127.0.0.1 still arrives from loopback, but with its own Host, and must not
 * be handed the token.
 */
const isLocalBrowser = (request: HttpServerRequest.HttpServerRequest): boolean => {
  const remote = Option.getOrElse(request.remoteAddress, () => "");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const host = (request.headers["host"] ?? "").replace(/:\d+$/, "");
  return loopback && LOCAL_HOSTS.has(host);
};

export const layerDevTokenRoute = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const devUrl = config.devUrl;
    if (devUrl === undefined) return Layer.empty;
    return HttpRouter.add("POST", "/api/auth/dev-token", (request) =>
      Effect.gen(function* () {
        const auth = yield* ServiceAuth.ServiceAuth;
        // Origin is a browser promise and the dev proxy sits on this machine, so both must hold.
        if (!isLocalBrowser(request) || request.headers["origin"] !== devUrl.origin)
          return HttpServerResponse.text("forbidden", { status: 403 });
        return yield* HttpServerResponse.json({ token: auth.token });
      }),
    );
  }),
);

/** Dev redirects to Vite; packaged builds serve `apps/web/dist` with SPA fallback. */
export const layerWebRoute = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const devUrl = config.devUrl;
    if (devUrl !== undefined) {
      return HttpRouter.add("GET", "*", (request) => {
        const target = new URL(request.url, devUrl);
        target.protocol = devUrl.protocol;
        target.host = devUrl.host;
        return Effect.succeed(HttpServerResponse.redirect(target.toString(), { status: 307 }));
      });
    }
    const staticDir = config.staticDir;
    if (staticDir === undefined) {
      return HttpRouter.add(
        "GET",
        "*",
        HttpServerResponse.text("No web UI built.", { status: 404 }),
      );
    }
    const indexPath = path.join(staticDir, "index.html");
    const auth = yield* ServiceAuth.ServiceAuth;
    const plainIndex = yield* fs.readFileString(indexPath).pipe(Effect.orElseSucceed(() => null));
    // The packaged app is served by the service itself, so the token rides in the page, but
    // only to a browser on this machine: a Tailnet-bound service must not hand it to the LAN.
    // Remote browsers get it from the connect flow instead.
    const withToken =
      plainIndex === null
        ? null
        : plainIndex.replace(
            "</head>",
            `<meta name="${TOKEN_META}" content="${auth.token}" /></head>`,
          );
    const index = plainIndex;
    if (index === null || withToken === null)
      return HttpRouter.add(
        "GET",
        "*",
        HttpServerResponse.text("No web UI built.", { status: 404 }),
      );
    return HttpRouter.add("GET", "*", (request) =>
      Effect.gen(function* () {
        const requested = path.normalize(
          path.join(staticDir, new URL(request.url, "http://x").pathname),
        );
        // normalize() keeps "../" escapes inside staticDir from reaching the filesystem.
        const candidate = requested.startsWith(staticDir) ? requested : indexPath;
        const isFile =
          candidate !== indexPath &&
          (yield* fs.stat(candidate).pipe(
            Effect.map((s) => s.type === "File"),
            Effect.orElseSucceed(() => false),
          ));
        if (isFile) return yield* HttpServerResponse.file(candidate);
        return HttpServerResponse.html(isLocalBrowser(request) ? withToken : index);
      }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Not found", { status: 404 }))),
    );
  }),
);

/**
 * External senders (a release pipeline, a blog) start a rule from here. No service
 * token: the per-rule HMAC secret is the credential, and the body is read raw so
 * the signature covers exactly the bytes the sender signed.
 */
export const layerWebhookRoute = HttpRouter.add("POST", "/api/webhooks/:ruleId", (request) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const ruleId = Number(params["ruleId"]);
    if (!Number.isInteger(ruleId) || ruleId <= 0)
      return yield* HttpServerResponse.json({ error: "bad_rule" }, { status: 404 });
    // Anyone can call this route, so the read itself is capped; the length check in
    // handleWebhook only runs once the whole body is in memory. 4 bytes covers any UTF-8 char.
    const body = yield* request.text.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        ByteSize.bytes(Webhooks.MAX_BODY_CHARS * 4),
      ),
    );
    const signature = request.headers["x-xtend-signature"] ?? null;
    const result = yield* Webhooks.handleWebhook(ruleId, signature, body);
    return yield* HttpServerResponse.json(result);
  }).pipe(
    Effect.catchTags({
      AutomateError: (error) =>
        HttpServerResponse.json(
          { error: error._tag, message: error.message },
          { status: error.detail === "bad signature" ? 401 : 404 },
        ),
    }),
    Effect.orElseSucceed(() => HttpServerResponse.text("bad request", { status: 400 })),
  ),
).pipe(Layer.provide(RuleStore.layer));

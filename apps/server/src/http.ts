import { ObservationBatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as ServerConfig from "./config.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";

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
    return HttpRouter.add("GET", "*", (request) =>
      Effect.gen(function* () {
        const requested = path.normalize(
          path.join(staticDir, new URL(request.url, "http://x").pathname),
        );
        // normalize() keeps "../" escapes inside staticDir from reaching the filesystem.
        const candidate = requested.startsWith(staticDir) ? requested : indexPath;
        const isFile = yield* fs.stat(candidate).pipe(
          Effect.map((s) => s.type === "File"),
          Effect.orElseSucceed(() => false),
        );
        return yield* HttpServerResponse.file(isFile ? candidate : indexPath);
      }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Not found", { status: 404 }))),
    );
  }),
);

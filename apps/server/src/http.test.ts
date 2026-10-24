// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- real sockets, raw Host headers, raw JSON and a built web dir are the point of this test.
import * as NodeFs from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/http";

import * as ServiceAuth from "./auth/ServiceAuth.ts";
import * as RuleStore from "./automate/RuleStore.ts";
import * as ServerConfig from "./config.ts";
import * as ServerHttp from "./http.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import * as SettingsStore from "./settings/SettingsStore.ts";
import * as TokenCipher from "./settings/TokenCipher.ts";

const TOKEN = "t".repeat(64);
const DEV = "http://localhost:5820";

// A built web app with a secret beside it, which no request may reach.
const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "xtend-http-"));
const staticDir = NodePath.join(root, "dist");
NodeFs.mkdirSync(NodePath.join(staticDir, "assets"), { recursive: true });
NodeFs.writeFileSync(
  NodePath.join(staticDir, "index.html"),
  "<html><head></head><body></body></html>",
);
NodeFs.writeFileSync(NodePath.join(staticDir, "assets", "app.js"), "boot()");
NodeFs.writeFileSync(NodePath.join(root, "secret.txt"), "secret");

const config = (devUrl: URL | undefined) =>
  ServerConfig.layer({
    version: "test",
    port: 4820,
    host: "127.0.0.1",
    baseDir: root,
    dbPath: ":memory:",
    staticDir: devUrl === undefined ? staticDir : undefined,
    devUrl,
    supervisor: "none",
  });

const layerAuth = Layer.succeed(ServiceAuth.ServiceAuth)(
  ServiceAuth.make({ token: TOKEN, allowedOrigins: new Set([DEV]) }),
);
const layerSocket = Layer.mergeAll(
  NodeHttpServer.layer(() => NodeHttp.createServer(), { port: 0 }),
  NodeServices.layer,
);
const serveOptions = { disableLogger: true, disableListenLog: true } as const;

const layerDev = HttpRouter.serve(
  Layer.mergeAll(ServerHttp.layerDevTokenRoute, ServerHttp.layerWebRoute),
  serveOptions,
).pipe(
  Layer.provideMerge(Layer.mergeAll(config(new URL(DEV)), layerAuth)),
  Layer.provideMerge(layerSocket),
);

const layerPackaged = HttpRouter.serve(
  Layer.mergeAll(
    ServerHttp.layerDevTokenRoute,
    ServerHttp.layerObservationsRoute,
    ServerHttp.layerWebhookRoute,
    ServerHttp.layerWebRoute,
  ),
  serveOptions,
).pipe(
  Layer.provideMerge(Layer.mergeAll(ObservationStore.layer, RuleStore.layer)),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(config(undefined), layerAuth, Sqlite.layerMemory, TokenCipher.layerTest),
  ),
  Layer.provideMerge(layerSocket),
);

const port = Effect.map(HttpServer.HttpServer, (s) =>
  s.address._tag === "UnixPathAddress" ? 0 : s.address.port,
);

/** node:http rather than fetch, so a test can send its own Host header and raw paths. */
const send = (
  p: number,
  request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  },
) =>
  Effect.promise(
    () =>
      new Promise<{ status: number; body: string; location: string | undefined }>(
        (resolve, reject) => {
          const req = NodeHttp.request({ host: "127.0.0.1", port: p, ...request }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }),
            );
          });
          req.on("error", reject);
          req.end(request.body);
        },
      ),
  );

describe("dev server routes", () => {
  it.effect("hands the token only to the dev page, addressed by a loopback name", () =>
    Effect.gen(function* () {
      const p = yield* port;
      const devToken = (headers: Record<string, string>) =>
        send(p, { method: "POST", path: "/api/auth/dev-token", headers });
      expect(yield* devToken({ origin: DEV })).toMatchObject({
        status: 200,
        body: JSON.stringify({ token: TOKEN }),
      });
      expect((yield* devToken({ origin: "http://evil.test" })).status).toBe(403);
      expect((yield* devToken({})).status).toBe(403);
      // DNS rebinding: a page at evil.example resolving to 127.0.0.1 claims the dev origin.
      expect((yield* devToken({ origin: DEV, host: "evil.example:5820" })).status).toBe(403);

      const page = yield* send(p, { method: "GET", path: "/compose?tab=queue" });
      expect([page.status, page.location]).toEqual([307, `${DEV}/compose?tab=queue`]);
    }).pipe(Effect.provide(layerDev)),
  );
});

describe("packaged server routes", () => {
  it.effect("serves the app with its token to this machine's browser only", () =>
    Effect.gen(function* () {
      const p = yield* port;
      const meta = `<meta name="xtend-token" content="${TOKEN}" />`;
      const get = (path: string, headers: Record<string, string> = {}) =>
        send(p, { method: "GET", path, headers });

      expect((yield* get("/")).body).toContain(meta);
      // A client route falls back to the app; a built file is served as is.
      expect((yield* get("/settings")).body).toContain(meta);
      expect((yield* get("/assets/app.js")).body).toBe("boot()");
      // A page on another host name (rebinding, a LAN peer) gets the app without the token.
      const foreign = yield* get("/", { host: "evil.example:4820" });
      expect([foreign.status, foreign.body.includes(TOKEN)]).toEqual([200, false]);
      // Escapes resolve inside the web dir, so the file beside it is never read.
      expect((yield* get("/%2e%2e/secret.txt")).body).not.toBe("secret");
      expect((yield* get("/../secret.txt")).body).not.toBe("secret");
      // No dev URL, no dev-token route.
      expect((yield* send(p, { method: "POST", path: "/api/auth/dev-token" })).status).toBe(404);
    }).pipe(Effect.provide(layerPackaged)),
  );

  it.effect("records a valid observation batch and refuses a malformed one", () =>
    Effect.gen(function* () {
      const p = yield* port;
      const observe = (body: unknown) =>
        send(p, {
          method: "POST",
          path: "/api/observations",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const valid = {
        viewerHandle: null,
        source: "home",
        observedAt: "2026-10-22T10:00:00.000Z",
        posts: [],
      };
      expect(yield* observe(valid)).toMatchObject({ status: 200, body: '{"posts":0}' });
      const bad = yield* observe({ ...valid, source: "dms" });
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.body)).toMatchObject({ error: "invalid_batch" });
    }).pipe(Effect.provide(layerPackaged)),
  );

  it.effect("stops reading an oversized webhook while it is still arriving", () =>
    Effect.gen(function* () {
      const p = yield* port;
      // The body never ends, so an uncapped read would wait on it forever.
      const outcome = yield* Effect.promise(
        () =>
          new Promise<number | "dropped">((resolve) => {
            const req = NodeHttp.request(
              { host: "127.0.0.1", port: p, method: "POST", path: "/api/webhooks/1" },
              (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
                req.destroy();
              },
            );
            // Past the cap the service drops the socket rather than buffer the rest.
            req.on("error", () => resolve("dropped"));
            req.write("x".repeat(512 * 1024));
          }),
      );
      expect(["dropped", 400]).toContain(outcome);
    }).pipe(Effect.provide(layerPackaged)),
  );
});

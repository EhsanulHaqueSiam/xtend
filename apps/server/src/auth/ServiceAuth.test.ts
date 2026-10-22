// @effect-diagnostics nodeBuiltinImport:off -- a real listening socket is the point of this test.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { RpcSerialization, RpcServer } from "effect/rpc";

import * as ServiceAuth from "./ServiceAuth.ts";

const TOKEN = "t".repeat(64);
const Ping = RpcGroup.make(
  Rpc.make("ping", { payload: Schema.Struct({}), success: Schema.String }),
);

// The same guard the real /ws and /api/observations routes use, around a one-method RPC server.
const routes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/ws",
    ServiceAuth.guarded(
      Effect.flatMap(
        RpcServer.toHttpEffectWebsocket(Ping).pipe(
          Effect.provide(
            Ping.toLayer({ ping: () => Effect.succeed("pong") }).pipe(
              Layer.provideMerge(RpcSerialization.layerJson),
            ),
          ),
        ),
        (handler) => handler,
      ),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/api/observations",
    ServiceAuth.guarded(Effect.succeed(HttpServerResponse.text("recorded"))),
  ),
);

const layerAuth = Layer.succeed(ServiceAuth.ServiceAuth)(
  ServiceAuth.make({ token: TOKEN, allowedOrigins: new Set(["http://localhost:5820"]) }),
);

const layerServer = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provideMerge(layerAuth),
  Layer.provideMerge(NodeHttpServer.layer(() => NodeHttp.createServer(), { port: 0 })),
  Layer.provideMerge(NodeServices.layer),
);

const port = Effect.map(HttpServer.HttpServer, (s) =>
  s.address._tag === "UnixPathAddress" ? 0 : s.address.port,
);

/** Resolves true when the socket opens, false when the server refuses the upgrade. */
const connects = (url: string, origin?: string) =>
  Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url, origin === undefined ? undefined : { headers: { origin } });
        ws.addEventListener("open", () => {
          ws.close();
          resolve(true);
        });
        ws.addEventListener("error", () => resolve(false));
      }),
  );

describe("ServiceAuth", () => {
  it.effect("refuses the WebSocket route without the token and accepts it with one", () =>
    Effect.gen(function* () {
      const p = yield* port;
      expect(yield* connects(`ws://127.0.0.1:${p}/ws`)).toBe(false);
      expect(yield* connects(`ws://127.0.0.1:${p}/ws?token=${"x".repeat(64)}`)).toBe(false);
      expect(yield* connects(`ws://127.0.0.1:${p}/ws?token=${TOKEN}`)).toBe(true);
      // A page from elsewhere is refused even when it somehow has the token.
      expect(yield* connects(`ws://127.0.0.1:${p}/ws?token=${TOKEN}`, "http://evil.test")).toBe(
        false,
      );
      expect(
        yield* connects(`ws://127.0.0.1:${p}/ws?token=${TOKEN}`, "http://localhost:5820"),
      ).toBe(true);
    }).pipe(Effect.provide(layerServer)),
  );

  it.effect("guards the observations route by bearer header", () =>
    Effect.gen(function* () {
      const p = yield* port;
      const post = (headers: Record<string, string>) =>
        Effect.promise(() =>
          fetch(`http://127.0.0.1:${p}/api/observations`, { method: "POST", headers }).then(
            (r) => r.status,
          ),
        );
      expect(yield* post({})).toBe(401);
      expect(yield* post({ authorization: `Bearer ${TOKEN}` })).toBe(200);
    }).pipe(Effect.provide(layerServer)),
  );
});

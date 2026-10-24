// @effect-diagnostics nodeBuiltinImport:off globalFetch:off preferSchemaOverJson:off -- a real socket and raw JSON are the point of this test.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServer } from "effect/http";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import * as ServiceAuth from "../auth/ServiceAuth.ts";
import * as HttpRpc from "./HttpRpc.ts";

const TOKEN = "t".repeat(64);

class Boom extends Schema.TaggedError<Boom>()("Boom", { why: Schema.String }) {}

const Group = RpcGroup.make(
  Rpc.make("math.double", {
    payload: Schema.Struct({ n: Schema.Number }),
    success: Schema.Struct({ doubled: Schema.Number }),
    error: Boom,
  }),
  // Every option defaulted, like a method that runs everything when told nothing.
  Rpc.make("math.count", {
    payload: Schema.Struct({ from: Schema.optional(Schema.Number) }),
    success: Schema.Number,
  }),
);

const routes = HttpRouter.add(
  "POST",
  "/api/rpc/:method",
  HttpRpc.handlerFor(Group).pipe(
    Effect.provide(
      Group.toLayer({
        "math.double": ({ n }) =>
          n < 0 ? new Boom({ why: "negative" }) : Effect.succeed({ doubled: n * 2 }),
        "math.count": ({ from }) => Effect.succeed(from ?? 0),
      }),
    ),
  ),
);

const layerServer = HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
  Layer.provideMerge(
    Layer.succeed(ServiceAuth.ServiceAuth)(
      ServiceAuth.make({ token: TOKEN, allowedOrigins: new Set() }),
    ),
  ),
  Layer.provideMerge(NodeHttpServer.layer(() => NodeHttp.createServer(), { port: 0 })),
  Layer.provideMerge(NodeServices.layer),
);

const port = Effect.map(HttpServer.HttpServer, (s) =>
  s.address._tag === "UnixPathAddress" ? 0 : s.address.port,
);

/** `body` is sent as is when it is a string, so a test can send raw or broken JSON. */
const post = (p: number, method: string, body: unknown, token?: string) =>
  Effect.promise(() =>
    fetch(`http://127.0.0.1:${p}/api/rpc/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }).then(async (r) => {
      const text = await r.text();
      // 401 is plain text from the guard; everything the bridge answers is JSON.
      return { status: r.status, body: r.status === 401 ? text : (JSON.parse(text) as unknown) };
    }),
  );

describe("HTTP rpc bridge", () => {
  it.effect("needs the token, decodes the payload and encodes success and errors", () =>
    Effect.gen(function* () {
      const p = yield* port;
      expect((yield* post(p, "math.double", { n: 2 })).status).toBe(401);
      expect(yield* post(p, "math.double", { n: 2 }, TOKEN)).toEqual({
        status: 200,
        body: { doubled: 4 },
      });
      expect(yield* post(p, "math.double", { n: -1 }, TOKEN)).toEqual({
        status: 422,
        body: { error: { _tag: "Boom", why: "negative" } },
      });
      expect((yield* post(p, "math.double", { n: "x" }, TOKEN)).status).toBe(400);
      expect((yield* post(p, "math.nope", {}, TOKEN)).status).toBe(404);
    }).pipe(Effect.provide(layerServer)),
  );

  it.effect("takes an empty body as {} but refuses a truncated one instead of defaulting it", () =>
    Effect.gen(function* () {
      const p = yield* port;
      expect(yield* post(p, "math.count", "", TOKEN)).toEqual({ status: 200, body: 0 });
      expect(yield* post(p, "math.count", '{"from": 5}', TOKEN)).toEqual({ status: 200, body: 5 });
      expect(yield* post(p, "math.count", '{"from": 5', TOKEN)).toMatchObject({
        status: 400,
        body: { error: "invalid_payload" },
      });
    }).pipe(Effect.provide(layerServer)),
  );
});

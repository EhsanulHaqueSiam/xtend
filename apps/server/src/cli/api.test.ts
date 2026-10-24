// @effect-diagnostics globalFetch:off -- Response is only the fake service's answer object; nothing is fetched.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as Api from "./api.ts";

/** An Api whose service answers every call with this status and body. */
const answering = (status: number, body: string) =>
  Api.layer({ url: "http://127.0.0.1:4820", token: "t" }).pipe(
    Layer.provide(
      Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status }))),
        ),
      ),
    ),
  );

describe("cli Api", () => {
  it.effect("returns the decoded answer of a 200", () =>
    Effect.gen(function* () {
      const api = yield* Api.Api;
      expect(yield* api.call("spend.summary", {})).toEqual({ monthUsd: 1 });
    }).pipe(Effect.provide(answering(200, '{"monthUsd":1}'))),
  );

  it.effect("says the service refused the token instead of calling it a bad answer", () =>
    Effect.gen(function* () {
      const api = yield* Api.Api;
      const error = yield* Effect.flip(Effect.asVoid(api.call("spend.summary", {})));
      expect(error.detail).toBe("spend.summary failed (401): unauthorized");
    }).pipe(Effect.provide(answering(401, "unauthorized"))),
  );
});

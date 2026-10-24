// @effect-diagnostics globalFetch:off -- Response is only the fake treg's answer object; nothing is fetched.
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as Budget from "../budget/Budget.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "./Treg.ts";
import { costOf } from "./Treg.ts";

/** What the fake treg answers next; `never` is a socket that stays open without a reply. */
let respond: (request: HttpClientRequest.HttpClientRequest) => Effect.Effect<Response> = () =>
  Effect.succeed(new Response("{}"));
const sent: Array<HttpClientRequest.HttpClientRequest> = [];

const fakeTreg = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) => {
    sent.push(request);
    return Effect.map(respond(request), (r) => HttpClientResponse.fromWeb(request, r));
  }),
);

// A token from the developer's shell would stand in for "no token".
delete process.env["XTEND_TREG_TOKEN"];

// The CLI-login fallback reads ~/.treg; a noop filesystem keeps the real one out of the test.
const layerTest = Treg.layer.pipe(
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      fakeTreg,
      FileSystem.layerNoop({}),
      Path.layer,
    ),
  ),
);

const read: Treg.TregCall = {
  endpoint: "anyapi.x.user.profile",
  body: { handle: "levelsio" },
  purpose: "test",
  cacheFor: Duration.hours(1),
  expectedCostUsd: 0.01,
};

const reply = (status: number, headers: Record<string, string> = {}) =>
  Effect.succeed(new Response('{"output":{}}', { status, headers }));

const setup = Effect.gen(function* () {
  sent.length = 0;
  respond = () => reply(200);
  const settings = yield* SettingsStore.SettingsStore;
  yield* settings.update({ tregToken: "trg_a", monthlyBudgetUsd: 1 });
  return { treg: yield* Treg.Treg, settings };
});

describe("Treg.costOf", () => {
  it("falls back to the quoted price when treg sends no cost, and says which it used", () => {
    expect(costOf({ "x-treg-cost-usd": "0.0007" }, {}, 0.001)).toEqual({
      costUsd: 0.0007,
      source: "header",
    });
    expect(costOf({}, { cost_usd: 0.0004 }, 0.001)).toEqual({ costUsd: 0.0004, source: "body" });
    expect(costOf({}, { data: [] }, 0.001)).toEqual({ costUsd: 0.001, source: "quote" });
  });
});

describe("Treg.call", () => {
  it.effect(
    "logs the quote for a silent answer, the header when sent, and nothing for refusals",
    () =>
      Effect.gen(function* () {
        const { treg, settings } = yield* setup;
        const write = {
          endpoint: "x/2/tweets",
          body: { text: "hi" },
          purpose: "test",
          expectedCostUsd: 0.015,
        };
        const monthUsd = Effect.map(settings.spendSummary, (s) => s.monthUsd);

        yield* treg.call(write);
        expect(yield* monthUsd).toBeCloseTo(0.015);
        respond = () => reply(201, { "x-treg-cost-usd": "0.2" });
        yield* treg.call(write);
        expect(yield* monthUsd).toBeCloseTo(0.215);

        for (const status of [401, 402, 429, 502]) {
          respond = () => reply(status);
          const error = yield* Effect.flip(treg.call(write));
          expect([error.reason, error.status]).toEqual(["provider", status]);
        }
        expect(yield* monthUsd).toBeCloseTo(0.215);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses before sending anything without a token or past the budget", () =>
    Effect.gen(function* () {
      const { treg, settings } = yield* setup;
      yield* settings.update({ tregToken: null });
      expect(yield* Effect.flip(treg.call(read))).toMatchObject({ reason: "no_token" });
      yield* settings.update({ tregToken: "trg_a", monthlyBudgetUsd: 0.005 });
      expect(yield* Effect.flip(treg.call(read))).toMatchObject({ reason: "budget" });
      expect(sent).toHaveLength(0);
      expect((yield* settings.spendSummary).monthUsd).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("serves a cached read free until it expires, and only to the token that paid", () =>
    Effect.gen(function* () {
      const { treg, settings } = yield* setup;
      expect((yield* treg.call(read)).cached).toBe(false);
      expect(yield* treg.call(read)).toMatchObject({ cached: true, costUsd: 0 });
      expect(yield* treg.isCached(read)).toBe(true);
      expect(sent).toHaveLength(1);

      // A different treg token is a different X connection: its `me` is not the old one's.
      yield* settings.update({ tregToken: "trg_b" });
      expect(yield* treg.isCached(read)).toBe(false);
      expect((yield* treg.call(read)).cached).toBe(false);
      expect(sent.map((r) => r.headers["x-treg-token"])).toEqual(["trg_a", "trg_b"]);

      yield* TestClock.adjust("61 minutes");
      expect(yield* treg.isCached(read)).toBe(false);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("fails an unreadable success instead of caching it as an empty page", () =>
    Effect.gen(function* () {
      const { treg } = yield* setup;
      const unreadable = [
        () => new Response("<html>502 Bad Gateway</html>"),
        // The connection drops halfway through the body.
        () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"output":'));
                controller.error(new Error("socket hang up"));
              },
            }),
          ),
      ];
      for (const answer of unreadable) {
        respond = () => Effect.succeed(answer());
        expect((yield* Effect.flip(treg.call(read))).reason).toBe("decode");
      }
      respond = () => reply(200);
      expect((yield* treg.call(read)).cached).toBe(false);

      // An empty success, like X's answer to some deletes, is still a success.
      respond = () => Effect.succeed(new Response(null, { status: 204 }));
      const deleted = yield* treg.call({
        endpoint: "x/2/tweets/1",
        method: "DELETE",
        purpose: "test",
      });
      expect(deleted.body).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "gives up on a call treg never answers, charges its quote and frees its reservation",
    () =>
      Effect.gen(function* () {
        const { treg, settings } = yield* setup;
        yield* settings.update({ monthlyBudgetUsd: 0.025 });
        const write = {
          endpoint: "x/2/tweets",
          body: { text: "hi" },
          purpose: "test",
          expectedCostUsd: 0.01,
        };
        respond = () => Effect.never;
        const hung = yield* Effect.forkChild(Effect.flip(treg.call(write)));
        yield* TestClock.adjust("2 minutes");
        const error = yield* Fiber.join(hung);
        expect(error.reason).toBe("http");

        // It may have been served, so it costs its quote. Had it also kept its 0.01 reserved, this
        // second 0.01 would pass the 0.025 budget.
        expect((yield* settings.spendSummary).monthUsd).toBeCloseTo(0.01);
        respond = () => reply(200);
        yield* treg.call(write);
        expect((yield* settings.spendSummary).monthUsd).toBeCloseTo(0.02);
      }).pipe(Effect.provide(layerTest)),
  );
});

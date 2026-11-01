// @effect-diagnostics nodeBuiltinImport:off -- util.format prints captured arguments as Node's console does.
import * as NodeUtil from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

import * as Observability from "./Observability.ts";

describe("service loggers", () => {
  it.effect("scrub what the console logger prints, outside any span", () => {
    const printed: Array<ReadonlyArray<unknown>> = [];
    const capture: Console.Console = {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => void printed.push(args),
      error: (...args: ReadonlyArray<unknown>) => void printed.push(args),
    };
    return Effect.gen(function* () {
      yield* Effect.logWarning("treg refused", {
        secret: ["opaque-secret"],
        cookies: { ct0: "cookiect0", auth_token: "cookieauth" },
        tregToken: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0-sig",
        tokenCount: 42,
      }).pipe(
        Effect.annotateLogs({ assistKey: "annotatedkey", url: "http://127.0.0.1/ws?token=abcd" }),
        Effect.andThen(Effect.logError("cause", new Error("Bearer causebearer"))),
      );
      yield* Effect.die({
        secret: ["opaque-secret-die"],
        cookies: { value: "opaque-cookie" },
      }).pipe(Effect.catchCause((cause) => Effect.logError("defect", cause)));
      yield* Effect.logError(
        "query",
        new Error("SQL execution failed", { cause: new Error("SQLITE_BUSY ct0=chainsecret") }),
      );
      // What stdout would show: Node formats the arguments, Errors with their cause chain.
      const text = printed.map((args) => NodeUtil.format(...args)).join("\n");
      expect(printed).toHaveLength(4);
      expect(text).toContain("treg refused");
      expect(text).toContain("tokenCount: 42");
      expect(text).toContain("SQLITE_BUSY");
      for (const secret of [
        "opaque-secret",
        "cookiect0",
        "cookieauth",
        "eyJhbGci",
        "annotatedkey",
        "token=abcd",
        "causebearer",
        "opaque-secret-die",
        "opaque-cookie",
        "chainsecret",
      ])
        expect(text).not.toContain(secret);
    }).pipe(
      Effect.provide(Observability.layerLoggers),
      Effect.provideService(Console.Console, capture),
    );
  });
});

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
      const text = JSON.stringify(printed);
      expect(printed).toHaveLength(2);
      expect(text).toContain("treg refused");
      expect(text).toContain('"tokenCount":42');
      for (const secret of [
        "opaque-secret",
        "cookiect0",
        "cookieauth",
        "eyJhbGci",
        "annotatedkey",
        "token=abcd",
        "causebearer",
      ])
        expect(text).not.toContain(secret);
    }).pipe(
      Effect.provide(Observability.layerLoggers),
      Effect.provideService(Console.Console, capture),
    );
  });
});

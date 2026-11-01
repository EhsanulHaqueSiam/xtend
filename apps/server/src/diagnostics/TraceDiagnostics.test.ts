import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as TraceDiagnostics from "./TraceDiagnostics.ts";

const MINUTE = 60_000;

const span = (
  name: string,
  durationMs: number,
  endMs: number,
  exit: object = { _tag: "Success" },
) =>
  JSON.stringify({
    type: "effect-span",
    name,
    traceId: `t-${endMs}`,
    durationMs,
    endTimeUnixNano: String(BigInt(endMs) * 1_000_000n),
    exit,
  });

const failure = (errorTag: string) => ({
  _tag: "Failure",
  errorTag,
  cause: `${errorTag}: boom\n  at x`,
});

describe("trace summary", () => {
  it("summarizes by span name inside the window, newest failures first", () => {
    const summary = TraceDiagnostics.makeTraceSummary(MINUTE);
    [
      span("ws.rpc.compose.draftsList", 500, 0),
      "",
      "{torn line",
      JSON.stringify({ name: "no-duration" }),
      ...Array.from({ length: 20 }, (_, i) => span("ws.rpc.compose.draftsList", i + 1, 2 * MINUTE)),
      span("Treg.call", 900, 3 * MINUTE, failure("XApiError")),
      span("Treg.call", 100, 4 * MINUTE, failure("BudgetExceeded")),
      span("Treg.call", 50, 5 * MINUTE, { _tag: "Interrupted", errorTag: "Interrupt", cause: "" }),
    ].forEach(summary.addLine);
    const result = summary.finish();

    expect(result.skippedLineCount).toBe(2);
    expect(result.spans).toEqual([
      {
        name: "ws.rpc.compose.draftsList",
        count: 20,
        p50Ms: 10,
        p95Ms: 19,
        maxMs: 20,
        failures: 0,
        interrupts: 0,
      },
      {
        name: "Treg.call",
        count: 3,
        p50Ms: 100,
        p95Ms: 900,
        maxMs: 900,
        failures: 2,
        interrupts: 1,
      },
    ]);
    expect(result.recentFailures.map((f) => [f.errorTag, f.cause])).toEqual([
      ["BudgetExceeded", "BudgetExceeded: boom"],
      ["XApiError", "XApiError: boom"],
    ]);
    const report = TraceDiagnostics.formatTraceSummary(result, 1);
    expect(report).toContain("1 more span names");
    expect(report).toContain("Treg.call  BudgetExceeded");
  });

  it.effect("reads rotated backups oldest first, and an absent file is no error", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const file = `${dir}/service.trace.ndjson`;
      yield* fs.writeFileString(`${file}.2`, `${span("a", 1, MINUTE)}\n`);
      yield* fs.writeFileString(file, `${span("b", 1, 2 * MINUTE)}\n`);
      const result = yield* TraceDiagnostics.readTraceSummary({ traceFile: file, maxFiles: 3 });
      expect(result.filesRead).toEqual([`${file}.2`, file]);
      expect(result.spans.map((s) => s.name)).toEqual(["a", "b"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import { vi } from "vite-plus/test";

import * as LocalTrace from "./LocalTrace.ts";

class Refused extends Schema.TaggedError<Refused>()("Refused", { status: Schema.Number }) {}

// Like XApiError: the message quotes what the provider said.
class Leaky extends Schema.TaggedError<Leaky>()("Leaky", { detail: Schema.String }) {
  override get message() {
    return this.detail;
  }
}

const sinkIn = (dir: string, options: Partial<LocalTrace.TraceSinkOptions> = {}) =>
  LocalTrace.makeTraceSink({
    filePath: `${dir}/service.trace.ndjson`,
    maxBytes: 1024 * 1024,
    maxFiles: 2,
    batchWindowMs: 1000,
    ...options,
  });

const readLines = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.map((text) => text.split("\n").filter((line) => line !== "")),
  );

describe("local trace file", () => {
  it.effect("records logs inside a span as events, and a failure with its error tag", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sink = yield* sinkIn(yield* fs.makeTempDirectoryScoped());
      const tracer = LocalTrace.makeTracer({ push: sink.push });
      yield* Effect.logWarning("treg was slow").pipe(
        Effect.andThen(new Refused({ status: 429 })),
        Effect.withSpan("Treg.call", { attributes: { "x.purpose": "library.search" } }),
        Effect.withTracer(tracer),
        Effect.ignore,
      );
      yield* sink.flush;
      const [record] = (yield* readLines(sink.filePath)).map(
        (line) => JSON.parse(line) as LocalTrace.TraceRecord,
      );
      expect(record).toMatchObject({
        name: "Treg.call",
        attributes: { "x.purpose": "library.search" },
        events: [{ name: "treg was slow", attributes: { "effect.logLevel": "WARN" } }],
        exit: { _tag: "Failure", errorTag: "Refused" },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never writes the treg token, the service token or X cookies", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sink = yield* sinkIn(yield* fs.makeTempDirectoryScoped());
      const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0-sig_part";
      const serviceToken = "ab12".repeat(16);
      const secrets = [
        jwt,
        serviceToken,
        "trg_live123",
        "cookieauth999",
        "ct0value",
        "bearer42",
        "structct0",
        "structauth",
        "structtwid",
        "structkdt",
        "assistsecret",
        "hooksecret",
        "attrct0",
      ];
      yield* Effect.logInfo(`calling with X-Treg-Token: ${jwt}`, { tregToken: "trg_live123" }).pipe(
        // Structured arguments are formatted into the event's name, not its attributes.
        Effect.andThen(
          Effect.logInfo("session", {
            cookies: {
              ct0: "structct0",
              auth_token: "structauth",
              twid: "structtwid",
              kdt: "structkdt",
            },
            assistKey: "assistsecret",
            webhookSecret: "hooksecret",
          }),
        ),
        Effect.andThen(Effect.annotateCurrentSpan({ ct0: "attrct0" })),
        Effect.andThen(
          Effect.annotateCurrentSpan({ "url.full": `http://127.0.0.1/ws?token=${serviceToken}` }),
        ),
        Effect.andThen(Effect.die(new Error("cookie: auth_token=cookieauth999; ct0=ct0value"))),
        Effect.withSpan("http GET /ws", { attributes: { authorization: "Bearer bearer42" } }),
        Effect.withTracer(LocalTrace.makeTracer({ push: sink.push })),
        Effect.exit,
      );
      yield* sink.flush;
      const text = (yield* readLines(sink.filePath)).join("\n");
      expect(text).toContain("<redacted>");
      for (const secret of secrets) expect(text).not.toContain(secret);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rotates by size and keeps only maxFiles backups", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const sink = yield* sinkIn(dir, { maxBytes: 600, maxFiles: 2 });
      const tracer = LocalTrace.makeTracer({ push: sink.push });
      for (let i = 0; i < 12; i++) {
        yield* Effect.void.pipe(Effect.withSpan(`span-${i}`), Effect.withTracer(tracer));
        yield* sink.flush;
      }
      expect((yield* fs.readDirectory(dir)).toSorted()).toEqual([
        "service.trace.ndjson",
        "service.trace.ndjson.1",
        "service.trace.ndjson.2",
      ]);
      const sizes = yield* Effect.forEach(yield* fs.readDirectory(dir), (name) =>
        Effect.map(fs.stat(`${dir}/${name}`), (stat) => Number(stat.size)),
      );
      expect(Math.max(...sizes)).toBeLessThanOrEqual(600);
      // The newest span is in the live file, the oldest ones are gone.
      expect((yield* readLines(sink.filePath)).at(-1)).toContain("span-11");
      const kept = [
        ...(yield* readLines(`${dir}/service.trace.ndjson.2`)),
        ...(yield* readLines(`${dir}/service.trace.ndjson.1`)),
        ...(yield* readLines(sink.filePath)),
      ];
      expect(kept.length).toBeLessThan(12);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("scrubs what an OTLP delegate sees, with no trace file", () => {
    const seen: Array<unknown> = [];
    class Captured extends Tracer.NativeSpan {
      override attribute(key: string, value: unknown) {
        seen.push([key, value]);
        super.attribute(key, value);
      }
      override event(name: string, time: bigint, attributes?: Record<string, unknown>) {
        seen.push([name, attributes]);
        super.event(name, time, attributes);
      }
      override end(time: bigint, exit: Exit.Exit<unknown, unknown>) {
        // What Effect's OTLP tracer exports for a failure: each error's message and stack.
        if (Exit.isFailure(exit))
          seen.push(
            Cause.prettyErrors(exit.cause, { includeCauseInStack: true }).map((e) => [
              e.message,
              e.stack,
            ]),
          );
        super.end(time, exit);
      }
    }
    const delegate = Tracer.make({ span: (options) => new Captured(options) });
    return Effect.gen(function* () {
      yield* Effect.logInfo("event", { ct0: "logct0", nested: { api_key: "lognested" } }).pipe(
        Effect.andThen(
          Effect.annotateCurrentSpan({ config: { api_key: "attrnested", region: "visible" } }),
        ),
        Effect.andThen(Effect.fail(new Leaky({ detail: "refused: Bearer bearersecret" }))),
        Effect.annotateLogs({ assistKey: "annotated" }),
        Effect.withSpan("Assist.generate"),
        Effect.withTracer(LocalTrace.makeTracer({ delegate })),
        Effect.exit,
      );
      yield* Effect.die(new Error("ct0=diect0")).pipe(
        Effect.withSpan("defect"),
        Effect.withTracer(LocalTrace.makeTracer({ delegate })),
        Effect.exit,
      );
      const text = JSON.stringify(seen);
      expect(text).toContain("visible");
      expect(text).toContain("refused");
      for (const secret of [
        "logct0",
        "lognested",
        "attrnested",
        "bearersecret",
        "annotated",
        "diect0",
      ])
        expect(text).not.toContain(secret);
    });
  });

  it.effect("makes an existing trace file owner-only before appending to it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${dir}/service.trace.ndjson`, "", { mode: 0o644 });
      yield* fs.chmod(`${dir}/service.trace.ndjson`, 0o644);
      const sink = yield* sinkIn(dir);
      yield* Effect.void.pipe(
        Effect.withSpan("s"),
        Effect.withTracer(LocalTrace.makeTracer({ push: sink.push })),
      );
      yield* sink.flush;
      expect((yield* fs.stat(sink.filePath)).mode & 0o777).toBe(0o600);
      expect(yield* readLines(sink.filePath)).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("writes nothing to a trace file it cannot make owner-only", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${dir}/service.trace.ndjson`, "");
      const refusing = FileSystem.FileSystem.of({
        ...fs,
        chmod: (path) =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "chmod",
              pathOrDescriptor: path,
            }),
          ),
      });
      const sink = yield* sinkIn(dir).pipe(Effect.provideService(FileSystem.FileSystem, refusing));
      yield* Effect.void.pipe(
        Effect.withSpan("s"),
        Effect.withTracer(LocalTrace.makeTracer({ push: sink.push })),
      );
      yield* sink.flush;
      expect(yield* readLines(sink.filePath)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("drains a full buffer without re-measuring the batch per line", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const sink = yield* sinkIn(dir, { maxBytes: 64 * 1024, maxFiles: 50 });
      const record = (i: number): LocalTrace.TraceRecord => ({
        type: "effect-span",
        name: `span-${i}`,
        kind: "internal",
        traceId: "t",
        spanId: String(i),
        startTimeUnixNano: "0",
        endTimeUnixNano: "1000000",
        durationMs: 1,
        attributes: { padding: "x".repeat(200) },
        events: [],
        exit: { _tag: "Success" },
      });
      // Filled and spied in one step, so the background flush cannot drain it first.
      const spy = yield* Effect.sync(() => {
        for (let i = 0; i < 2000; i++) sink.push(record(i));
        return vi.spyOn(Buffer, "byteLength");
      });
      yield* sink.flush;
      // Characters measured while draining; a per-line re-measure of the chunk is quadratic in them.
      // Read before mockRestore, which clears the recorded calls.
      const measured = spy.mock.calls.reduce(
        (total, [value]) => total + (typeof value === "string" ? value.length : 0),
        0,
      );
      spy.mockRestore();
      const files = yield* fs.readDirectory(dir);
      const written = yield* Effect.forEach(files, (name) => readLines(`${dir}/${name}`));
      expect(files.length).toBeGreaterThan(5);
      expect(written.flat()).toHaveLength(2000);
      expect(measured).toBeLessThanOrEqual(written.flat().join("\n").length);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

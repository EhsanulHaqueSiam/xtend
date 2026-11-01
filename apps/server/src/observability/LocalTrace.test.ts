import * as NodeServices from "@effect/platform-node/NodeServices";
// @effect-diagnostics nodeBuiltinImport:off -- util.format prints captured arguments as Node's console does.
import * as NodeUtil from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
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

/** A delegate recording what an OTLP exporter would receive: attributes, events, failures, names. */
const capturing = () => {
  const seen: Array<unknown> = [];
  const spans: Array<Tracer.NativeSpan> = [];
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
      // What Effect's OTLP tracer exports for a failure: each error's name, message and stack.
      if (Exit.isFailure(exit))
        seen.push(
          Cause.prettyErrors(exit.cause, { includeCauseInStack: true }).map((e) => [
            e.name,
            e.message,
            e.stack,
          ]),
        );
      super.end(time, exit);
    }
  }
  const delegate = Tracer.make({
    span: (options) => {
      const span = new Captured(options);
      spans.push(span);
      return span;
    },
  });
  return { seen, spans, delegate };
};

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
        "opaque-secret",
        "objsecret",
        "987654321",
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
            secret: ["opaque-secret"],
            credentials: { user: "objsecret" },
            kdt: 987654321,
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
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(NodeServices.layer, Logger.layer([LocalTrace.tracerLogger]))),
    ),
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
    const { seen, spans, delegate } = capturing();
    const renamed = new Error("ct0=diect0");
    renamed.name = "Bearer namesecret";
    return Effect.gen(function* () {
      yield* Effect.logInfo("event", {
        ct0: "logct0",
        nested: { api_key: "lognested" },
        secret: ["arraysecret"],
        cookies: { auth_token: "objectsecret" },
        twid: 4242424242,
      }).pipe(
        Effect.andThen(
          Effect.annotateCurrentSpan({
            config: { api_key: "attrnested", region: "visible" },
            tokenCount: 42,
          }),
        ),
        Effect.andThen(
          Effect.flatMap(Effect.currentSpan, (span) =>
            Effect.sync(() =>
              span.addLinks([
                {
                  span: Tracer.externalSpan({ spanId: "s1", traceId: "t1" }),
                  attributes: { ct0: "linksecret" },
                },
              ]),
            ),
          ),
        ),
        Effect.andThen(Effect.fail(new Leaky({ detail: "refused: Bearer bearersecret" }))),
        Effect.annotateLogs({ assistKey: "annotated" }),
        Effect.withSpan("Assist.generate"),
        Effect.withTracer(LocalTrace.makeTracer({ delegate })),
        Effect.exit,
      );
      yield* Effect.die(renamed).pipe(
        Effect.withSpan("defect"),
        Effect.withTracer(LocalTrace.makeTracer({ delegate })),
        Effect.exit,
      );
      const text = JSON.stringify([seen, spans.map((span) => span.links)]);
      expect(text).toContain("visible");
      expect(text).toContain("refused");
      for (const secret of [
        "logct0",
        "lognested",
        "arraysecret",
        "objectsecret",
        "4242424242",
        "attrnested",
        "bearersecret",
        "annotated",
        "diect0",
        "namesecret",
        "linksecret",
      ])
        expect(text).not.toContain(secret);
      // A count keeps its value and type; a link reaches the delegate once.
      expect(seen).toContainEqual(["tokenCount", 42]);
      expect(spans[0]?.links).toHaveLength(1);
    }).pipe(Effect.provide(Logger.layer([LocalTrace.tracerLogger])));
  });

  it.effect("scrubs failure values, span names and a token at the cut, keeping call sites", () => {
    const { seen, spans, delegate } = capturing();
    const records: Array<LocalTrace.TraceRecord> = [];
    const tracer = LocalTrace.makeTracer({ delegate, push: (record) => records.push(record) });
    const serviceToken = "ab12".repeat(16);
    return Effect.gen(function* () {
      yield* Effect.die({ secret: ["opaque-secret"], cookies: { value: "opaque-cookie" } }).pipe(
        Effect.withSpan("die"),
        Effect.withTracer(tracer),
        Effect.exit,
      );
      yield* Effect.fail({ password: "failsecret", note: ["kept"] }).pipe(
        Effect.withSpan("fail"),
        Effect.withTracer(tracer),
        Effect.exit,
      );
      // Logged inside a span: the cause lands as the event's `effect.cause`.
      yield* Effect.die({ secret: ["eventsecret"] }).pipe(
        Effect.catchCause((cause) => Effect.logError("caught", cause)),
        Effect.withSpan("caught"),
        Effect.withTracer(tracer),
      );
      // The cut at 2,000 characters would split the token after its first 63 characters.
      yield* Effect.annotateCurrentSpan({ note: `${" ".repeat(1937)}${serviceToken}` }).pipe(
        Effect.withSpan("GET /token=opaque-service-token"),
        Effect.withTracer(tracer),
      );
      yield* Effect.fail(new Leaky({ detail: "y".repeat(3000) })).pipe(
        Effect.withSpan("long"),
        Effect.withTracer(tracer),
        Effect.exit,
      );
      const text = JSON.stringify([seen, spans.map((span) => span.name), records]);
      expect(text).toContain("kept");
      for (const secret of [
        "opaque-secret",
        "opaque-cookie",
        "failsecret",
        "eventsecret",
        "opaque-service-token",
        serviceToken.slice(0, 16),
      ])
        expect(text).not.toContain(secret);
      // The message is cut on its own budget; the frames after it survive.
      const long = records.find((r) => r.name === "long");
      expect(long?.exit._tag === "Failure" && long.exit.cause).toContain("    at ");
      expect(JSON.stringify(seen.at(-1))).toContain("    at ");
      // Past the 64 KB scan the token is cut after 16 characters; redacting the bearer shrinks the
      // rest under the output limit, so a fragment at the cut would otherwise show.
      yield* Effect.annotateCurrentSpan({
        scanned: `Bearer ${"A".repeat(65490)}\n${" ".repeat(22)}${serviceToken}`,
      }).pipe(Effect.withSpan("scan-cut"), Effect.withTracer(tracer));
      expect(JSON.stringify([seen, records])).not.toContain(serviceToken.slice(0, 16));
    }).pipe(Effect.provide(Logger.layer([LocalTrace.tracerLogger])));
  });

  it.effect("keeps the operation frames of a failure and scrubs a secret-shaped one", () => {
    const { seen, delegate } = capturing();
    const records: Array<LocalTrace.TraceRecord> = [];
    const tracer = LocalTrace.makeTracer({ delegate, push: (record) => records.push(record) });
    const printed: Array<ReadonlyArray<unknown>> = [];
    const capture: Console.Console = {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => void printed.push(args),
      error: (...args: ReadonlyArray<unknown>) => void printed.push(args),
    };
    const outerOperation = Effect.fn("outerOperation")(function* () {
      return yield* Effect.fail(new Error("broken"));
    });
    const leaky = Effect.fn("leakyOperation token=framesecret")(function* () {
      return yield* Effect.fail(new Error("broken too"));
    });
    return Effect.gen(function* () {
      for (const operation of [outerOperation(), leaky()])
        yield* operation.pipe(
          Effect.tapCause((cause) => Effect.logError("failed", cause)),
          Effect.withSpan("caller"),
          Effect.withTracer(tracer),
          Effect.exit,
        );
      const callers = records.filter((r) => r.name === "caller");
      const console = printed.map((args) => NodeUtil.format(...args)).join("\n");
      const exported = JSON.stringify(seen);
      for (const text of [JSON.stringify(callers), console, exported]) {
        expect(text).toContain("outerOperation");
        expect(text).toContain("leakyOperation");
        expect(text).not.toContain("framesecret");
      }
    }).pipe(
      Effect.provide(Logger.layer([LocalTrace.tracerLogger, LocalTrace.consoleLogger])),
      Effect.provideService(Console.Console, capture),
    );
  });

  it("names credentials by their last word, not by substring", () => {
    const secret = [
      "token",
      "auth_token",
      "tregToken",
      "x-treg-token",
      "http.request.header.authorization",
      "set-cookie",
      "cookies",
      "secret",
      "webhookSecret",
      "password",
      "bearer",
      "api_key",
      "apiKey",
      "assistKey",
      "private_key",
      "ct0",
      "twid",
      "kdt",
      "credential",
      "credentials",
      "sessionId",
      "session_id",
      "sessionToken",
      "sessionKey",
      "password_hash",
      "passwordHash",
      "refresh_token",
      "accessToken",
      "id_token",
      "client_secret",
      "csrf",
      "csrfToken",
      "x-csrf-token",
      "authToken",
    ];
    const harmless = [
      "tokenCount",
      "token_budget",
      "tokens",
      "tregTokenSet",
      "x.purpose",
      "keywords",
      "monthlyBudgetUsd",
      "key",
      "id",
      "userId",
      "hash",
      "session",
      "sessionCount",
      "passwordUpdatedAt",
    ];
    expect(secret.filter((key) => !LocalTrace.isSecretKey(key))).toEqual([]);
    expect(harmless.filter(LocalTrace.isSecretKey)).toEqual([]);
  });

  it("scrubs a megabyte in one pass, whatever its shape", () => {
    const mb = 1024 * 1024;
    // Each would take minutes with a pattern that backtracks quadratically.
    for (const text of [
      "a".repeat(mb),
      "a.".repeat(mb / 2),
      '"k":'.repeat(mb / 4),
      `ct0=${"v".repeat(mb)}`,
      `"secret": "${"x\\".repeat(mb / 2)}`,
    ])
      expect(LocalTrace.redactText(text).length).toBeLessThanOrEqual(text.length);
    expect(
      LocalTrace.redactText('cookie: auth_token=a1; ct0=b2, "kdt": "c3", authorization: Bearer d4'),
    ).toBe('cookie: <redacted>; ct0=<redacted>, "kdt": "<redacted>", authorization: <redacted>');
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

  it.effect("writes nothing to a trace file it cannot make owner-only, and says so once", () => {
    const logged: Array<string> = [];
    return Effect.gen(function* () {
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
      // An empty flush between two refused ones is not a recovery.
      yield* sink.flush;
      yield* Effect.void.pipe(
        Effect.withSpan("t"),
        Effect.withTracer(LocalTrace.makeTracer({ push: sink.push })),
      );
      yield* sink.flush;
      expect(yield* readLines(sink.filePath)).toEqual([]);
      expect(logged).toEqual(["trace write failed; dropping records"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.merge(
          NodeServices.layer,
          Logger.layer([
            Logger.make(({ message }) => {
              logged.push(String(Array.isArray(message) ? message[0] : message));
            }),
          ]),
        ),
      ),
    );
  });

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

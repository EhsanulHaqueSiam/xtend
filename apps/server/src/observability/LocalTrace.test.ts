import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as LocalTrace from "./LocalTrace.ts";

class Refused extends Schema.TaggedError<Refused>()("Refused", { status: Schema.Number }) {}

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
      const tracer = LocalTrace.makeLocalFileTracer(sink);
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
      const secrets = [jwt, serviceToken, "trg_live123", "cookieauth999", "ct0value", "bearer42"];
      yield* Effect.logInfo(`calling with X-Treg-Token: ${jwt}`, { tregToken: "trg_live123" }).pipe(
        Effect.andThen(
          Effect.annotateCurrentSpan({ "url.full": `http://127.0.0.1/ws?token=${serviceToken}` }),
        ),
        Effect.andThen(Effect.die(new Error("cookie: auth_token=cookieauth999; ct0=ct0value"))),
        Effect.withSpan("http GET /ws", { attributes: { authorization: "Bearer bearer42" } }),
        Effect.withTracer(LocalTrace.makeLocalFileTracer(sink)),
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
      const tracer = LocalTrace.makeLocalFileTracer(sink);
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
});

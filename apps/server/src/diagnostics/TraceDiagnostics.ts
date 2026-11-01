import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

class TraceFileReadError extends Schema.TaggedError<TraceFileReadError>()("TraceFileReadError", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not read the trace file ${this.path}.`;
  }
}

/** Oldest backup first, the live file last, so lines come out in the order they were written. */
const rotatedTracePaths = (traceFile: string, maxFiles: number): ReadonlyArray<string> => [
  ...Array.from({ length: Math.max(0, maxFiles) }, (_, i) => `${traceFile}.${maxFiles - i}`),
  traceFile,
];

/** Feeds each line of `path` to `onLine`; succeeds with false when the file does not exist. */
const streamTraceLines = (
  fs: FileSystem.FileSystem,
  path: string,
  onLine: (line: string) => void,
) =>
  fs.stream(path).pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEachArray((lines) => Effect.sync(() => lines.forEach(onLine))),
    Effect.as(true),
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(false)
          : Effect.fail(new TraceFileReadError({ path, cause })),
    }),
  );

const decodeSpanLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      traceId: Schema.optional(Schema.String),
      durationMs: Schema.Finite,
      endTimeUnixNano: Schema.FiniteFromString,
      exit: Schema.optional(
        Schema.Struct({
          _tag: Schema.String,
          errorTag: Schema.optional(Schema.String),
          cause: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
);

const RECENT_FAILURES = 10;

/**
 * Folds trace lines into per-span-name stats and the latest failures. Lines that are not spans
 * (a torn last line, another tool's output) are counted, not fatal.
 */
export const makeTraceSummary = (sinceMs = -Infinity) => {
  const byName = new Map<string, { durations: number[]; failures: number; interrupts: number }>();
  const failures: Array<{
    readonly name: string;
    readonly endMs: number;
    readonly durationMs: number;
    readonly errorTag: string;
    readonly cause: string;
    readonly traceId: string;
  }> = [];
  let spanCount = 0;
  let skippedLineCount = 0;
  let firstEndMs = Infinity;
  let lastEndMs = -Infinity;

  const addLine = (line: string) => {
    if (line.trim() === "") return;
    const span = Option.getOrUndefined(decodeSpanLine(line));
    const endMs = span === undefined ? NaN : span.endTimeUnixNano / 1_000_000;
    if (span === undefined || Option.isNone(DateTime.make(endMs))) {
      skippedLineCount += 1;
      return;
    }
    if (endMs < sinceMs) return;
    spanCount += 1;
    firstEndMs = Math.min(firstEndMs, endMs);
    lastEndMs = Math.max(lastEndMs, endMs);
    const stats = byName.get(span.name) ?? { durations: [], failures: 0, interrupts: 0 };
    stats.durations.push(span.durationMs);
    if (span.exit?._tag === "Interrupted") stats.interrupts += 1;
    if (span.exit?._tag === "Failure") {
      stats.failures += 1;
      failures.push({
        name: span.name,
        endMs,
        durationMs: span.durationMs,
        errorTag: span.exit.errorTag ?? "Failure",
        cause: span.exit.cause?.split("\n")[0] ?? "",
        traceId: span.traceId ?? "",
      });
      // Keep the newest few without holding every failure of a noisy day.
      if (failures.length > RECENT_FAILURES * 4)
        failures.splice(0, failures.length - RECENT_FAILURES);
    }
    byName.set(span.name, stats);
  };

  const finish = () => {
    const spans = [...byName]
      .map(([name, { durations, failures, interrupts }]) => {
        const sorted = durations.toSorted((a, b) => a - b);
        const at = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
        return {
          name,
          count: sorted.length,
          p50Ms: at(0.5),
          p95Ms: at(0.95),
          maxMs: sorted[sorted.length - 1] ?? 0,
          failures,
          interrupts,
        };
      })
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const recentFailures = failures.toSorted((a, b) => b.endMs - a.endMs).slice(0, RECENT_FAILURES);
    return { spanCount, skippedLineCount, firstEndMs, lastEndMs, spans, recentFailures };
  };

  return { addLine, finish };
};

export type TraceSummary = ReturnType<ReturnType<typeof makeTraceSummary>["finish"]>;

/** Reads the live trace file and its backups directly, so it works with the service stopped. */
export const readTraceSummary = Effect.fn("TraceDiagnostics.readTraceSummary")(function* (options: {
  readonly traceFile: string;
  readonly maxFiles: number;
  readonly sinceMs?: number | undefined;
}) {
  const fs = yield* FileSystem.FileSystem;
  const summary = makeTraceSummary(options.sinceMs);
  const paths = rotatedTracePaths(options.traceFile, options.maxFiles);
  const found = yield* Effect.forEach(paths, (path) => streamTraceLines(fs, path, summary.addLine));
  return { ...summary.finish(), filesRead: paths.filter((_, i) => found[i]) };
});

const formatMs = (ms: number) =>
  Math.round(ms) < 1000 ? `${Math.round(ms)}ms` : `${Math.round(ms / 100) / 10}s`;
const formatIso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
  return rows.map((row) =>
    row
      .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!)))
      .join("  "),
  );
};

/** The `xtend trace` report: busiest span names first, then the latest failures. */
export const formatTraceSummary = (summary: TraceSummary, limit: number) => {
  if (summary.spanCount === 0) return "No spans in that window.";
  const minutes = (summary.lastEndMs - summary.firstEndMs) / 60_000;
  const lines = [
    `${summary.spanCount} spans ended from ${formatIso(summary.firstEndMs)} to ${formatIso(summary.lastEndMs)} (${minutes.toFixed(1)} min).`,
    ...(summary.skippedLineCount > 0
      ? [`Skipped ${summary.skippedLineCount} lines that are not spans.`]
      : []),
    "",
    ...table([
      ["span", "count", "p50", "p95", "max", "failed", "interrupted"],
      ...summary.spans
        .slice(0, limit)
        .map((s) => [
          s.name,
          String(s.count),
          formatMs(s.p50Ms),
          formatMs(s.p95Ms),
          formatMs(s.maxMs),
          String(s.failures),
          String(s.interrupts),
        ]),
    ]),
    ...(summary.spans.length > limit
      ? [`${summary.spans.length - limit} more span names; --limit shows more.`]
      : []),
  ];
  if (summary.recentFailures.length === 0) return lines.join("\n");
  return [
    ...lines,
    "",
    "Latest failures:",
    ...summary.recentFailures.flatMap((f) => [
      `${formatIso(f.endMs)}  ${f.name}  ${f.errorTag}  ${formatMs(f.durationMs)}  trace ${f.traceId}`,
      ...(f.cause === "" ? [] : [`  ${f.cause.slice(0, 160)}`]),
    ]),
  ].join("\n");
};

import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Tracer from "effect/Tracer";

/** One completed span, one line of `service.trace.ndjson`. */
export interface TraceRecord {
  readonly type: "effect-span";
  readonly name: string;
  readonly kind: Tracer.SpanKind;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly events: ReadonlyArray<{
    readonly name: string;
    readonly timeUnixNano: string;
    readonly attributes: Readonly<Record<string, unknown>>;
  }>;
  readonly exit:
    | { readonly _tag: "Success" }
    | {
        readonly _tag: "Failure" | "Interrupted";
        readonly errorTag: string;
        readonly cause: string;
      };
}

const REDACTED = "<redacted>";
const SECRET_KEY = /token|secret|password|cookie|authorization|api[-_]?key/i;
// The treg token is JWT-shaped, the service token 64 hex chars; X's session cookies ride as name=value.
const SECRET_TEXT: ReadonlyArray<readonly [RegExp, string]> = [
  [/eyJ[\w-]{8,}(?:\.[\w-]+)*/g, REDACTED],
  [/\btrg_[\w-]+/g, REDACTED],
  [/\b[a-f0-9]{64}\b/g, REDACTED],
  [/(Bearer\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`],
  [/((?:x-treg-token|authorization|cookie)["']?\s*[:=]\s*["']?)[^"'\\\n]+/gi, `$1${REDACTED}`],
  [/(\b(?:token|access_token|auth_token|ct0|twid|kdt|api_key)=)[^&#;\s"'\\]+/gi, `$1${REDACTED}`],
];

const redactText = (text: string) =>
  SECRET_TEXT.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);

const MAX_STRING = 500;
const MAX_SQL = 200;
const MAX_DEPTH = 6;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;

// Plain JSON only: a Map, Error or class instance would otherwise serialize as {} or throw.
const toJson = (value: unknown, depth: number): unknown => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncate(value, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (value instanceof Error)
    return { name: value.name, message: truncate(value.message, MAX_STRING) };
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => toJson(entry, depth + 1));
  if (value instanceof Map) return attributesToJson(Object.fromEntries(value), depth + 1);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return attributesToJson(value as Record<string, unknown>, depth + 1);
  return truncate(String(value), MAX_STRING);
};

const attributesToJson = (attributes: Readonly<Record<string, unknown>>, depth = 0) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    out[key] =
      typeof value === "string" && SECRET_KEY.test(key)
        ? REDACTED
        : key === "db.query.text" && typeof value === "string"
          ? truncate(value, MAX_SQL)
          : toJson(value, depth);
  }
  return out;
};

/** The tag of the first typed failure, or the reason kind (Die, Interrupt) when there is none. */
const causeErrorTag = (cause: Cause.Cause<unknown>): string => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isNone(failure)) return cause.reasons[0]?._tag ?? "Empty";
  const error = failure.value;
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
  )
    return error._tag;
  return error instanceof Error ? error.name : typeof error;
};

const exitOf = (exit: Exit.Exit<unknown, unknown>): TraceRecord["exit"] =>
  Exit.isSuccess(exit)
    ? { _tag: "Success" }
    : {
        _tag: Cause.hasInterruptsOnly(exit.cause) ? "Interrupted" : "Failure",
        errorTag: causeErrorTag(exit.cause),
        cause: truncate(Cause.pretty(exit.cause), 4 * MAX_STRING),
      };

export interface TraceSinkOptions {
  readonly filePath: string;
  /** Rotate once the live file would pass this size. */
  readonly maxBytes: number;
  /** Rotated backups kept beside the live file (`.1` newest). */
  readonly maxFiles: number;
  readonly batchWindowMs: number;
}

const FLUSH_AT_RECORDS = 256;

/**
 * Buffers serialized records and appends them in batches, rotating by size. Writes never fail
 * the caller: a disk error drops that batch and warns once until a write succeeds again.
 */
export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { filePath, maxBytes } = options;
  const maxFiles = Math.max(1, options.maxFiles);
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(Effect.ignore);
  let size = yield* fs.stat(filePath).pipe(
    Effect.map((stat) => Number(stat.size)),
    Effect.orElseSucceed(() => 0),
  );
  let buffer: Array<string> = [];
  let bufferBytes = 0;
  let failing = false;
  const maxBufferBytes = Math.max(maxBytes, 4 * 1024 * 1024);

  const rotate = Effect.gen(function* () {
    yield* fs.remove(`${filePath}.${maxFiles}`, { force: true });
    for (let index = maxFiles - 1; index >= 1; index--) {
      const source = `${filePath}.${index}`;
      if (yield* fs.exists(source)) yield* fs.rename(source, `${filePath}.${index + 1}`);
    }
    if (yield* fs.exists(filePath)) yield* fs.rename(filePath, `${filePath}.1`);
    size = 0;
  });

  const append = Effect.fn("TraceSink.append")(function* (chunk: string) {
    const bytes = Buffer.byteLength(chunk);
    if (size > 0 && size + bytes > maxBytes) yield* rotate;
    yield* fs.writeFileString(filePath, chunk, { flag: "a", mode: 0o600 });
    size += bytes;
  });

  const flushBuffered = Effect.gen(function* () {
    const lines = buffer;
    buffer = [];
    bufferBytes = 0;
    let chunk = "";
    for (const line of lines) {
      if (chunk !== "" && Buffer.byteLength(chunk) + Buffer.byteLength(line) > maxBytes) {
        yield* append(chunk);
        chunk = "";
      }
      chunk += line;
    }
    if (chunk !== "") yield* append(chunk);
  });

  const lock = yield* Semaphore.make(1);
  const flush = flushBuffered.pipe(
    Effect.matchEffect({
      onSuccess: () =>
        failing
          ? Effect.sync(() => (failing = false)).pipe(
              Effect.andThen(Effect.logInfo("trace writes recovered", { filePath })),
            )
          : Effect.void,
      onFailure: (cause) =>
        failing
          ? Effect.void
          : Effect.sync(() => (failing = true)).pipe(
              Effect.andThen(Effect.logWarning("trace write failed; dropping records", cause)),
            ),
    }),
    lock.withPermits(1),
    Effect.uninterruptible,
    // Writing spans must not record spans, or every flush would schedule another.
    Effect.withTracerEnabled(false),
    Effect.updateContext(Context.omit(Tracer.ParentSpan)<never>),
  );

  const requests = yield* Queue.sliding<void>(1);
  yield* Effect.addFinalizer(() => flush);
  yield* Queue.take(requests).pipe(
    Effect.timeoutOption(`${options.batchWindowMs} millis`),
    Effect.andThen(flush),
    Effect.forever,
    Effect.forkScoped,
  );

  return {
    filePath,
    flush,
    push: (record: TraceRecord) => {
      const line = `${redactText(JSON.stringify(record))}\n`;
      const bytes = Buffer.byteLength(line);
      if (bytes > maxBytes || bufferBytes + bytes > maxBufferBytes) return;
      buffer.push(line);
      bufferBytes += bytes;
      if (buffer.length >= FLUSH_AT_RECORDS) Queue.offerUnsafe(requests, undefined);
    },
  };
});

export type TraceSink = Effect.Success<ReturnType<typeof makeTraceSink>>;

/** Wraps the span another tracer made (native or OTLP) and writes it to the sink when it ends. */
class LocalFileSpan implements Tracer.Span {
  readonly _tag = "Span";
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly parent: Option.Option<Tracer.AnySpan>;
  readonly annotations: Context.Context<never>;
  readonly links: Array<Tracer.SpanLink>;
  readonly sampled: boolean;
  readonly kind: Tracer.SpanKind;
  status: Tracer.SpanStatus;
  readonly attributes = new Map<string, unknown>();
  readonly events: Array<readonly [string, bigint, Record<string, unknown>]> = [];
  private readonly delegate: Tracer.Span;
  private readonly push: (record: TraceRecord) => void;

  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    delegate: Tracer.Span,
    push: (record: TraceRecord) => void,
  ) {
    this.delegate = delegate;
    this.push = push;
    this.name = delegate.name;
    this.spanId = delegate.spanId;
    this.traceId = delegate.traceId;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = [...options.links];
    this.sampled = delegate.sampled;
    this.kind = delegate.kind;
    this.status = { _tag: "Started", startTime: options.startTime };
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    // The success value can be a whole result set; a trace only needs to know it succeeded.
    const traceExit = Exit.isSuccess(exit) ? Exit.void : exit;
    const startTime = this.status.startTime;
    this.status = { _tag: "Ended", startTime, endTime, exit: traceExit };
    this.delegate.end(endTime, traceExit);
    if (!this.sampled) return;
    const parentSpanId = Option.getOrUndefined(this.parent)?.spanId;
    this.push({
      type: "effect-span",
      name: this.name,
      kind: this.kind,
      traceId: this.traceId,
      spanId: this.spanId,
      ...(parentSpanId === undefined ? {} : { parentSpanId }),
      startTimeUnixNano: String(startTime),
      endTimeUnixNano: String(endTime),
      durationMs: Number(endTime - startTime) / 1_000_000,
      attributes: attributesToJson(Object.fromEntries(this.attributes)),
      events: this.events.map(([name, time, attributes]) => ({
        name: truncate(name, MAX_STRING),
        timeUnixNano: String(time),
        attributes: attributesToJson(attributes),
      })),
      exit: exitOf(traceExit),
    });
  }

  attribute(key: string, value: unknown): void {
    // Redacted before the delegate sees it, so an OTLP backend gets the same safe value.
    const safe =
      typeof value !== "string" ? value : SECRET_KEY.test(key) ? REDACTED : redactText(value);
    this.attributes.set(key, safe);
    this.delegate.attribute(key, safe);
  }

  event(name: string, startTime: bigint, attributes: Record<string, unknown> = {}): void {
    const cause = attributes["effect.cause"];
    const safe =
      typeof cause === "string" ? { ...attributes, "effect.cause": redactText(cause) } : attributes;
    this.events.push([redactText(name), startTime, safe]);
    this.delegate.event(redactText(name), startTime, safe);
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    this.links.push(...links);
    this.delegate.addLinks(links);
  }
}

/** A tracer that records every sampled span to `sink`, passing each one on to `delegate`. */
export const makeLocalFileTracer = (
  sink: Pick<TraceSink, "push">,
  delegate: Tracer.Tracer = Tracer.make({ span: (options) => new Tracer.NativeSpan(options) }),
): Tracer.Tracer =>
  Tracer.make({
    span: (options) => new LocalFileSpan(options, delegate.span(options), sink.push),
    ...(delegate.context === undefined ? {} : { context: delegate.context }),
  });

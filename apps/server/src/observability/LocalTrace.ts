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
// Credential names: X's session cookies, the treg and service tokens, assist keys, webhook secrets.
const SECRET_NAMES =
  "token|secret|password|passwd|cookie|authorization|bearer|api[-_]?key|assist[-_.]?key|private[-_]?key|ct0|twid|kdt|credential";
const SECRET_KEY = new RegExp(SECRET_NAMES, "i");
// The treg token is JWT-shaped, the service token 64 hex chars; X's session cookies ride as name=value.
const SECRET_TEXT: ReadonlyArray<readonly [RegExp, string]> = [
  // A quoted key naming a credential, as JSON or inspect writes a structured log argument.
  [
    new RegExp(
      `(["']?[\\w.-]*(?:${SECRET_NAMES})[\\w.-]*["']?\\s*:\\s*)(["'])(?:\\\\.|(?!\\2).)*\\2`,
      "gi",
    ),
    `$1$2${REDACTED}$2`,
  ],
  [/eyJ[\w-]{8,}(?:\.[\w-]+)*/g, REDACTED],
  [/\btrg_[\w-]+/g, REDACTED],
  [/\b[a-f0-9]{64}\b/g, REDACTED],
  [/(Bearer\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`],
  [/((?:x-treg-token|authorization|cookie)["']?\s*[:=]\s*["']?)[^"'\\\n]+/gi, `$1${REDACTED}`],
  [
    /(\b(?:token|access_token|auth_token|ct0|twid|kdt|api_key|secret)=)[^&#;\s"'\\]+/gi,
    `$1${REDACTED}`,
  ],
];

const redactText = (text: string) =>
  SECRET_TEXT.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);

const MAX_DEPTH = 6;

const safeError = (error: Error) => {
  const copy = new Error(redactText(error.message));
  copy.name = error.name;
  if (error.stack !== undefined) copy.stack = redactText(error.stack);
  return copy;
};

/**
 * A copy with credential-named keys replaced and every string scrubbed. Values that are not plain
 * data become their scrubbed string, so nothing reaches a tracer unexamined. Booleans are kept:
 * `tregTokenSet: true` says nothing secret.
 */
const sanitize = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (value instanceof Error) return safeError(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (value instanceof Map) return sanitizeAttributes(Object.fromEntries(value), depth + 1);
  if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    return sanitizeAttributes(value as Record<string, unknown>, depth + 1);
  return redactText(String(value));
};

const sanitizeAttributes = (attributes: Readonly<Record<string, unknown>>, depth = 0) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes))
    out[key] =
      SECRET_KEY.test(key) && value != null && typeof value !== "boolean"
        ? REDACTED
        : sanitize(value, depth);
  return out;
};

/** The exit a tracer may see: failures rebuilt from scrubbed messages and stacks, never the errors. */
const sanitizeExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> => {
  if (Exit.isSuccess(exit)) return Exit.void;
  if (Cause.hasInterruptsOnly(exit.cause)) return exit;
  const errors = Cause.prettyErrors(exit.cause, { includeCauseInStack: true }).map(safeError);
  return Exit.failCause(Cause.fromReasons(errors.map(Cause.makeDieReason)));
};

const MAX_STRING = 500;
const MAX_SQL = 200;

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
      key === "db.query.text" && typeof value === "string"
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

// The tag comes from the original cause (tags are code), the text from the scrubbed one.
const exitOf = (
  exit: Exit.Exit<unknown, unknown>,
  safe: Exit.Exit<unknown, unknown>,
): TraceRecord["exit"] =>
  Exit.isSuccess(exit) || Exit.isSuccess(safe)
    ? { _tag: "Success" }
    : {
        _tag: Cause.hasInterruptsOnly(exit.cause) ? "Interrupted" : "Failure",
        errorTag: causeErrorTag(exit.cause),
        cause: truncate(Cause.pretty(safe.cause), 4 * MAX_STRING),
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

const joinText = (lines: ReadonlyArray<{ readonly text: string }>, start: number, end: number) =>
  lines
    .slice(start, end)
    .map((line) => line.text)
    .join("");

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
  let buffer: Array<{ readonly text: string; readonly bytes: number }> = [];
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

  // `mode` only applies when the file is created; one made earlier (XTEND_TRACE_FILE) may be 0644.
  // A file that cannot be made owner-only gets nothing written to it.
  const secure = fs.chmod(filePath, 0o600).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.void : Effect.fail(error),
    }),
  );

  const append = Effect.fn("TraceSink.append")(function* (chunk: string, bytes: number) {
    if (size > 0 && size + bytes > maxBytes) yield* rotate;
    yield* secure;
    yield* fs.writeFileString(filePath, chunk, { flag: "a", mode: 0o600 });
    size += bytes;
  });

  // Each line's size was measured once on push; chunks are joined once, so draining is linear.
  const flushBuffered = Effect.gen(function* () {
    const lines = buffer;
    buffer = [];
    bufferBytes = 0;
    let start = 0;
    let chunkBytes = 0;
    for (let index = 0; index < lines.length; index++) {
      const bytes = lines[index]!.bytes;
      if (chunkBytes > 0 && chunkBytes + bytes > maxBytes) {
        yield* append(joinText(lines, start, index), chunkBytes);
        start = index;
        chunkBytes = 0;
      }
      chunkBytes += bytes;
    }
    if (chunkBytes > 0) yield* append(joinText(lines, start, lines.length), chunkBytes);
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
      const text = `${redactText(JSON.stringify(record))}\n`;
      const bytes = Buffer.byteLength(text);
      if (bytes > maxBytes || bufferBytes + bytes > maxBufferBytes) return;
      buffer.push({ text, bytes });
      bufferBytes += bytes;
      if (buffer.length >= FLUSH_AT_RECORDS) Queue.offerUnsafe(requests, undefined);
    },
  };
});

/**
 * Wraps the span another tracer made (native or OTLP). Everything the delegate sees, attributes,
 * events, links and the exit, is scrubbed first; with `push`, the ended span also goes to the file.
 */
class SafeSpan implements Tracer.Span {
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
  private readonly push: ((record: TraceRecord) => void) | undefined;

  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    delegate: Tracer.Span,
    push: ((record: TraceRecord) => void) | undefined,
  ) {
    this.delegate = delegate;
    this.push = push;
    this.name = delegate.name;
    this.spanId = delegate.spanId;
    this.traceId = delegate.traceId;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links;
    this.sampled = delegate.sampled;
    this.kind = delegate.kind;
    this.status = { _tag: "Started", startTime: options.startTime };
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    // A success value can be a whole result set, a failure can quote a token; neither is kept.
    const safeExit = sanitizeExit(exit);
    const startTime = this.status.startTime;
    this.status = { _tag: "Ended", startTime, endTime, exit: safeExit };
    this.delegate.end(endTime, safeExit);
    if (!this.sampled || this.push === undefined) return;
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
      exit: exitOf(exit, safeExit),
    });
  }

  attribute(key: string, value: unknown): void {
    const safe = sanitizeAttributes({ [key]: value })[key];
    this.attributes.set(key, safe);
    this.delegate.attribute(key, safe);
  }

  event(name: string, startTime: bigint, attributes: Record<string, unknown> = {}): void {
    const safeName = redactText(name);
    const safe = sanitizeAttributes(attributes);
    this.events.push([safeName, startTime, safe]);
    this.delegate.event(safeName, startTime, safe);
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    const safe = links.map(sanitizeLink);
    this.links.push(...safe);
    this.delegate.addLinks(safe);
  }
}

const sanitizeLink = (link: Tracer.SpanLink): Tracer.SpanLink => ({
  ...link,
  attributes: sanitizeAttributes(link.attributes),
});

/**
 * The service's tracer: scrubs every span before `delegate` (native by default, OTLP when set)
 * sees it, and with `push` records each sampled span for the trace file.
 */
export const makeTracer = (options: {
  readonly push?: ((record: TraceRecord) => void) | undefined;
  readonly delegate?: Tracer.Tracer | undefined;
}): Tracer.Tracer => {
  const delegate = options.delegate ?? Tracer.make({ span: (span) => new Tracer.NativeSpan(span) });
  return Tracer.make({
    span: (span) => {
      const safe = { ...span, links: span.links.map(sanitizeLink) };
      return new SafeSpan(safe, delegate.span(safe), options.push);
    },
    ...(delegate.context === undefined ? {} : { context: delegate.context }),
  });
};

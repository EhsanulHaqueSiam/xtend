import { isSecretKey, REDACTED, redactText } from "@xtend/contracts";
import * as Cause from "effect/Cause";
import * as Console from "effect/Console";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Inspectable from "effect/Inspectable";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
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

const MAX_DEPTH = 6;
const MAX_SCRUBBED = 2000;
const MAX_FRAMES = 4000;
// Only bounds the work. Past it, the run a cut splits is dropped (see `scanned`), so no fragment
// of a token can survive even when redaction shrinks the text under the output limit.
const MAX_SCANNED = 64 * 1024;
const TOKEN_CHAR = /[\w.~+/=-]/;

/** The text up to the scan budget, less any token-shaped run the cut would split. */
const scanned = (text: string) => {
  if (text.length <= MAX_SCANNED) return text;
  let end = MAX_SCANNED;
  while (end > 0 && TOKEN_CHAR.test(text[end - 1]!)) end--;
  return text.slice(0, end);
};

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;

// Redacted before it is cut, so a cut can never leave the visible part of a token behind.
const scrub = (text: string, max = MAX_SCRUBBED) => truncate(redactText(scanned(text)), max);

/**
 * A scrubbed copy: name, message, the stack's frames on their own budget (a long message must not
 * push the call sites out), and its `cause` chain, depth-bounded.
 */
const safeError = (error: Error, depth = 0): Error => {
  const cause = "cause" in error ? sanitize(error.cause, depth + 1) : undefined;
  const copy =
    cause === undefined
      ? new Error(scrub(error.message))
      : new Error(scrub(error.message), { cause });
  copy.name = scrub(error.name);
  const head = `${error.name}: ${error.message}`;
  if (error.stack !== undefined)
    copy.stack = error.stack.startsWith(head)
      ? `${copy.name}: ${copy.message}${scrub(error.stack.slice(head.length), MAX_FRAMES)}`
      : scrub(error.stack, MAX_SCRUBBED + MAX_FRAMES);
  return copy;
};

/**
 * A copy with credential-named keys replaced and every string scrubbed. Values that are not plain
 * data become their scrubbed string, so nothing reaches a tracer unexamined. Booleans are kept:
 * `tregTokenSet: true` says nothing secret.
 */
const sanitize = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return scrub(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (value instanceof Error) return safeError(value, depth);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, depth + 1));
  if (value instanceof Map) return sanitizeAttributes(Object.fromEntries(value), depth + 1);
  if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    return sanitizeAttributes(value as Record<string, unknown>, depth + 1);
  return scrub(String(value));
};

const sanitizeAttributes = (attributes: Readonly<Record<string, unknown>>, depth = 0) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes))
    out[key] =
      isSecretKey(key) && value != null && typeof value !== "boolean"
        ? REDACTED
        : sanitize(value, depth);
  return out;
};

/** The cause with every failure and defect value sanitised, so formatting it can show no secret. */
const sanitizeCause = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> =>
  Cause.fromReasons(
    cause.reasons.map((reason) =>
      // The original annotations carry the operation and definition frames; every rendered cause
      // goes through `scrub`, which cleans names in them.
      reason._tag === "Fail"
        ? Cause.makeFailReason(sanitize(reason.error)).annotate(Cause.reasonAnnotations(reason))
        : reason._tag === "Die"
          ? Cause.makeDieReason(sanitize(reason.defect)).annotate(Cause.reasonAnnotations(reason))
          : reason,
    ),
  );

/**
 * Effect's tracer logger, with the log's arguments sanitised before they are formatted into the
 * event's name. Formatted text cannot be redacted reliably: `{ secret: ["x"] }` keeps no quoted
 * value next to its key. `Observability` puts it in place of the built-in one.
 */
export const tracerLogger = Logger.make(({ cause, fiber, logLevel, message, date }) => {
  const span = Context.getOrUndefined(fiber.context, Tracer.ParentSpan);
  if (span === undefined || span._tag === "ExternalSpan") return;
  const parts = (Array.isArray(message) ? message : [message]).map((part) => sanitize(part));
  span.event(
    Inspectable.toStringUnknown(parts.length === 1 ? parts[0] : parts),
    BigInt(date.getTime()) * 1_000_000n,
    {
      ...fiber.getRef(References.CurrentLogAnnotations),
      "effect.fiberId": fiber.id,
      "effect.logLevel": logLevel.toUpperCase(),
      ...(cause.reasons.length > 0 ? { "effect.cause": Cause.pretty(sanitizeCause(cause)) } : {}),
    },
  );
});

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Effect's default console logger, same line format, with the message, the cause and the
 * annotations sanitised. The desktop pipes stdout to `<baseDir>/service.log`, next to the trace
 * file, so it gets the same treatment. `Observability` puts it in place of the built-in one.
 */
export const consoleLogger = Logger.make(({ cause, fiber, logLevel, message, date }) => {
  const parts = (Array.isArray(message) ? message : [message]).map((part) => sanitize(part));
  if (cause.reasons.length > 0) parts.push(scrub(Cause.pretty(sanitizeCause(cause)), MAX_FRAMES));
  const annotations = fiber.getRef(References.CurrentLogAnnotations);
  if (Object.keys(annotations).length > 0) parts.push(sanitizeAttributes(annotations));
  const now = date.getTime();
  const spans = fiber
    .getRef(References.CurrentLogSpans)
    // Scrubbed before the format's separators are swapped out, or `token=x` would hide as `token_x`.
    .map(([label, start]) => ` ${scrub(label).replace(/[\s="]/g, "_")}=${now - start}ms`)
    .join("");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  const console = fiber.getRef(Console.Console);
  const log = fiber.getRef(References.LogToStderr) ? console.error : console.log;
  log(`[${time}] ${logLevel.toUpperCase()} (#${fiber.id})${spans}:`, ...parts);
});

/** The exit a tracer may see: failures rebuilt from scrubbed messages and stacks, never the errors. */
const sanitizeExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> => {
  if (Exit.isSuccess(exit)) return Exit.void;
  if (Cause.hasInterruptsOnly(exit.cause)) return exit;
  const errors = Cause.prettyErrors(sanitizeCause(exit.cause), { includeCauseInStack: true }).map(
    (error) => safeError(error),
  );
  return Exit.failCause(Cause.fromReasons(errors.map(Cause.makeDieReason)));
};

const MAX_STRING = 500;
const MAX_SQL = 200;

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
        // The scrubbed errors already bound message and frames; this only caps several of them.
        cause: truncate(Cause.pretty(safe.cause), 2 * (MAX_SCRUBBED + MAX_FRAMES)),
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
    return lines.length;
  });

  const lock = yield* Semaphore.make(1);
  const flush = flushBuffered.pipe(
    Effect.matchEffect({
      // Only a write that happened is a recovery; an empty flush proves nothing.
      onSuccess: (written) =>
        failing && written > 0
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
  name: string;
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
    // Its own array: the delegate keeps `options.links`, and each records its own `addLinks`.
    this.links = [...options.links];
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
    // HTTP spans start as `http GET` (the path is not a name: ids, tokens); the router names the
    // route it matched, a template like `/api/rpc/:method`. The delegate keeps the bare name.
    if (key === "http.route" && typeof safe === "string" && /^http [A-Z]+$/.test(this.name))
      this.name = `${this.name} ${safe}`;
    this.attributes.set(key, safe);
    this.delegate.attribute(key, safe);
  }

  event(name: string, startTime: bigint, attributes: Record<string, unknown> = {}): void {
    const safeName = scrub(name);
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
      const safe = { ...span, name: scrub(span.name), links: span.links.map(sanitizeLink) };
      return new SafeSpan(safe, delegate.span(safe), options.push);
    },
    ...(delegate.context === undefined ? {} : { context: delegate.context }),
  });
};

import * as Cause from "effect/Cause";
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

const REDACTED = "<redacted>";

// Matched on a key's last word, so `tregToken` and `auth_token` are credentials and `tokenCount`,
// `token_budget` and `tokens` are not.
const SECRET_WORDS: ReadonlySet<string> = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "cookie",
  "cookies",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "ct0",
  "twid",
  "kdt",
]);
const SECRET_KEY_PAIRS: ReadonlySet<string> = new Set([
  "api key",
  "assist key",
  "private key",
  "access key",
]);

/** Whether an attribute or argument key names a credential, judged by its last word or two. */
export const isSecretKey = (key: string) => {
  const words = (key.split(".").pop() ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  const last = words.at(-1) ?? "";
  return SECRET_WORDS.has(last) || SECRET_KEY_PAIRS.has(words.slice(-2).join(" "));
};

// Every pattern here is linear: no two adjacent quantifiers can match the same characters.
// The treg token is JWT-shaped and the service token 64 hex chars.
const SECRET_SHAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/eyJ[\w-]{8,}(?:\.[\w-]+)*/g, REDACTED],
  [/\btrg_[\w-]+/g, REDACTED],
  [/\b[a-f0-9]{64}\b/g, REDACTED],
  [/(Bearer\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`],
];

// A candidate `key: value` or `key=value`, the key starting at a word boundary and bounded.
const PAIR = /(?<![\w.-])(["']?)([A-Za-z_][\w.-]{0,79})\1\s*([:=])\s*/g;
// `key=value` (a query, a cookie) ends at whitespace too; `key: value` (a header) runs on.
const UNQUOTED_END = { ":": /[\n\r,;&#}\]"'\\]/, "=": /[\s,;&#}\]"'\\]/ };

/** Where a pair's value ends: its closing quote, or the first separator. */
const valueEnd = (text: string, start: number, separator: string) => {
  const quote = text[start];
  if (quote === '"' || quote === "'") {
    for (let at = start + 1; at < text.length; at++) {
      if (text[at] === "\\") at++;
      else if (text[at] === quote) return at + 1;
    }
    return text.length;
  }
  if (quote === "[" || quote === "{") return start; // Containers are sanitised before formatting.
  const end = UNQUOTED_END[separator === "=" ? "=" : ":"];
  let at = start;
  while (at < text.length && !end.test(text[at]!)) at++;
  return at;
};

/** One pass over the text: each credential-named pair's value becomes `<redacted>`. */
const redactPairs = (text: string) => {
  let out = "";
  let copied = 0;
  PAIR.lastIndex = 0;
  for (let match = PAIR.exec(text); match !== null; match = PAIR.exec(text)) {
    if (!isSecretKey(match[2]!)) continue;
    const start = match.index + match[0].length;
    const end = valueEnd(text, start, match[3]!);
    if (end === start) continue;
    const quote = text[start] === '"' || text[start] === "'" ? text[start]! : "";
    out += `${text.slice(copied, start)}${quote}${REDACTED}${quote}`;
    copied = end;
    PAIR.lastIndex = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
};

/** Scrubs credential shapes and credential-named pairs. Linear in the text's length. */
export const redactText = (text: string) =>
  redactPairs(
    SECRET_SHAPES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text),
  );

const MAX_DEPTH = 6;
// Anything from outside (a User-Agent, a provider's error) is cut to this before any pattern runs.
const MAX_SCRUBBED = 2000;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;

const scrub = (text: string) => redactText(truncate(text, MAX_SCRUBBED));

const safeError = (error: Error) => {
  const copy = new Error(scrub(error.message));
  copy.name = scrub(error.name);
  if (error.stack !== undefined) copy.stack = scrub(error.stack);
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
  if (value instanceof Error) return safeError(value);
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
      ...(cause.reasons.length > 0 ? { "effect.cause": Cause.pretty(cause) } : {}),
    },
  );
});

/** The exit a tracer may see: failures rebuilt from scrubbed messages and stacks, never the errors. */
const sanitizeExit = (exit: Exit.Exit<unknown, unknown>): Exit.Exit<unknown, unknown> => {
  if (Exit.isSuccess(exit)) return Exit.void;
  if (Cause.hasInterruptsOnly(exit.cause)) return exit;
  const errors = Cause.prettyErrors(exit.cause, { includeCauseInStack: true }).map(safeError);
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
      const safe = { ...span, links: span.links.map(sanitizeLink) };
      return new SafeSpan(safe, delegate.span(safe), options.push);
    },
    ...(delegate.context === undefined ? {} : { context: delegate.context }),
  });
};

import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { formatTraceSummary, readTraceSummary } from "../diagnostics/TraceDiagnostics.ts";

const UNITS = { s: Duration.seconds, m: Duration.minutes, h: Duration.hours, d: Duration.days };

/** `30m`, `2h`, `7d`, or anything `Duration.fromInput` reads (`90 minutes`). */
export const parseSince = (text: string): Option.Option<Duration.Duration> => {
  const short = /^(\d+)\s*([smhd])$/.exec(text.trim());
  if (short === null) return Duration.fromInput(text.trim() as Duration.Input);
  return Option.some(UNITS[short[2] as keyof typeof UNITS](Number(short[1])));
};

/** The report `xtend trace` prints, read straight from the trace files under `baseDir`. */
export const traceReport = Effect.fn("cli.trace")(function* (input: {
  readonly baseDir: string;
  readonly since: Option.Option<Duration.Duration>;
  readonly limit: number;
}) {
  const settings = yield* ServerConfig.observability(input.baseDir);
  const sinceMs = Option.isSome(input.since)
    ? (yield* Clock.currentTimeMillis) - Duration.toMillis(input.since.value)
    : undefined;
  const summary = yield* readTraceSummary({
    traceFile: settings.traceFile,
    maxFiles: settings.traceMaxFiles,
    sinceMs,
  });
  if (summary.filesRead.length === 0)
    return `No trace file at ${settings.traceFile}${settings.traceEnabled ? "" : " (XTEND_TRACE_DISABLED is set)"}.`;
  return `${settings.traceFile}\n${formatTraceSummary(summary, input.limit)}`;
});

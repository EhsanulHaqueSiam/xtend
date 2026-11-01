import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";

// Labels stay low-cardinality: a method, a transport, an area, an outcome. Ids and text go on spans.

export const rpcRequestsTotal = Metric.counter("xtend_rpc_requests_total", {
  description: "RPC requests handled, by method, transport and outcome.",
});

export const rpcRequestDuration = Metric.timer("xtend_rpc_request_duration", {
  description: "RPC request handling time, by method and transport.",
});

export const xCallsTotal = Metric.counter("xtend_x_calls_total", {
  description: "Calls through treg, cached ones included, by purpose area and outcome.",
});

export const xSpendUsd = Metric.counter("xtend_x_spend_usd", {
  description: "Dollars treg charged, by purpose area.",
});

const jobRunsTotal = Metric.counter("xtend_job_runs_total", {
  description: "Scheduler, automation and daily job runs, by job and outcome.",
});

const jobRunDuration = Metric.timer("xtend_job_run_duration", {
  description: "Scheduler, automation and daily job run time, by job.",
});

export const eventLoopStallsTotal = Metric.counter("xtend_event_loop_stalls_total", {
  description: "Event loop stalls over the threshold.",
  incremental: true,
});

export type Outcome = "success" | "failure" | "interrupt";

export const outcomeOf = (exit: Exit.Exit<unknown, unknown>): Outcome =>
  Exit.isSuccess(exit) ? "success" : Cause.hasInterruptsOnly(exit.cause) ? "interrupt" : "failure";

/** `purpose` is `area.detail`, where detail may be a rule or agent name; metrics keep the area. */
export const purposeArea = (purpose: string) => purpose.split(".")[0] || "unknown";

export const increment = (
  metric: Metric.Metric<number, unknown>,
  attributes: Readonly<Record<string, string>>,
  amount = 1,
) => Metric.update(Metric.withAttributes(metric, attributes), amount);

/** Counts the effect by outcome and times it on the monotonic clock; interruptions count too. */
export const withMetrics =
  (options: {
    readonly counter: Metric.Metric<number, unknown>;
    readonly timer: Metric.Metric<Duration.Duration, unknown>;
    readonly attributes: Readonly<Record<string, string>>;
  }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(Clock.monotonicTimeNanos, (startedAt) =>
      Effect.onExit(effect, (exit) =>
        Effect.flatMap(Clock.monotonicTimeNanos, (endedAt) =>
          Effect.andThen(
            Metric.update(
              Metric.withAttributes(options.timer, options.attributes),
              Duration.nanos(endedAt - startedAt),
            ),
            increment(options.counter, { ...options.attributes, outcome: outcomeOf(exit) }),
          ),
        ),
      ),
    );

/** For a scheduler loop's tick: `tick.pipe(Metrics.withJobMetrics("compose.scheduler"))`. */
export const withJobMetrics = (job: string) =>
  withMetrics({ counter: jobRunsTotal, timer: jobRunDuration, attributes: { job } });

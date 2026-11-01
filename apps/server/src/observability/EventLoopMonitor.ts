// @effect-diagnostics nodeBuiltinImport:off -- only node:perf_hooks exposes the event loop delay histogram.
import * as NodePerfHooks from "node:perf_hooks";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import type * as Scope from "effect/Scope";

import * as Metrics from "./Metrics.ts";

// The histogram can overcount a gap by its resolution, so that much is subtracted.
const RESOLUTION_MS = 1000;
const STALL_THRESHOLD_MS = 2000;
const SAMPLE_INTERVAL = "30 seconds";

/** One sample window. Delay in ns, active time in ms, CPU in µs. */
export interface EventLoopReadings {
  readonly delayMaxNs: number;
  readonly activeMs: number;
  readonly utilization: number;
  readonly userCpuUs: number;
  readonly systemCpuUs: number;
  readonly majorPageFaults: number;
  readonly rssBytes: number;
}

/** The stall in ms worth recording, or undefined. */
export const stallMs = ({ delayMaxNs, activeMs }: EventLoopReadings) => {
  const delayMs = Math.round(delayMaxNs / 1e6) - RESOLUTION_MS;
  // libuv's clock runs while macOS sleeps; a loop that was idle that long was asleep, not stalled.
  if (delayMs <= STALL_THRESHOLD_MS || activeMs < delayMs) return undefined;
  return delayMs;
};

const nodeSampler = Effect.gen(function* () {
  const histogram = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const created = NodePerfHooks.monitorEventLoopDelay({ resolution: RESOLUTION_MS });
      created.enable();
      return created;
    }),
    (histogram) => Effect.sync(() => histogram.disable()),
  );
  let elu = NodePerfHooks.performance.eventLoopUtilization();
  let usage = process.resourceUsage();
  return Effect.sync((): EventLoopReadings => {
    const nextElu = NodePerfHooks.performance.eventLoopUtilization();
    const nextUsage = process.resourceUsage();
    const loop = NodePerfHooks.performance.eventLoopUtilization(nextElu, elu);
    const readings = {
      delayMaxNs: histogram.max,
      activeMs: loop.active,
      utilization: loop.utilization,
      userCpuUs: nextUsage.userCPUTime - usage.userCPUTime,
      systemCpuUs: nextUsage.systemCPUTime - usage.systemCPUTime,
      majorPageFaults: nextUsage.majorPageFault - usage.majorPageFault,
      rssBytes: process.memoryUsage().rss,
    };
    histogram.reset();
    elu = nextElu;
    usage = nextUsage;
    return readings;
  });
});

/**
 * Samples every 30 s and records a stall as a root `service.eventLoop.stall` span with a warning
 * event. The first window covers startup (migrations), so it is skipped.
 */
export const layerWith = (
  sampler: Effect.Effect<Effect.Effect<EventLoopReadings>, never, Scope.Scope>,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sample = yield* sampler;
      const tick = Effect.gen(function* () {
        const readings = yield* sample;
        const delayMaxMs = stallMs(readings);
        if (delayMaxMs === undefined) return;
        yield* Metric.update(Metrics.eventLoopStallsTotal, 1);
        yield* Effect.logWarning(`event loop stalled for ${delayMaxMs} ms`).pipe(
          Effect.withSpan("service.eventLoop.stall", {
            root: true,
            attributes: {
              delayMaxMs,
              utilization: Math.round(readings.utilization * 100) / 100,
              cpuUserMs: Math.round(readings.userCpuUs / 1000),
              cpuSystemMs: Math.round(readings.systemCpuUs / 1000),
              majorPageFaults: readings.majorPageFaults,
              rssMb: Math.round(readings.rssBytes / 1024 / 1024),
            },
          }),
        );
      });
      const wait = Effect.sleep(SAMPLE_INTERVAL);
      yield* wait.pipe(
        Effect.andThen(sample),
        Effect.andThen(wait.pipe(Effect.andThen(tick), Effect.forever)),
        Effect.forkScoped,
      );
    }),
  );

export const layer = layerWith(nodeSampler);

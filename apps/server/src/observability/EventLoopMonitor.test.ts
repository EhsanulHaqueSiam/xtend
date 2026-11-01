import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";

import * as EventLoopMonitor from "./EventLoopMonitor.ts";
import * as LocalTrace from "./LocalTrace.ts";

const ms = (value: number) => value * 1e6;

// Node reports a stall of S as a gap of up to S + 1 s, the histogram's resolution.
const stalled: EventLoopMonitor.EventLoopReadings = {
  delayMaxNs: ms(5_950),
  activeMs: 6_200,
  utilization: 0.18,
  userCpuUs: 310_400,
  systemCpuUs: 95_600,
  majorPageFaults: 12,
  rssBytes: 512 * 1024 * 1024,
};

describe("event loop monitor", () => {
  it("ignores delay the loop spent idle, such as a system sleep", () => {
    const asleep = { ...stalled, delayMaxNs: ms(600_000), activeMs: 900 };
    expect(EventLoopMonitor.stallMs(asleep)).toBeUndefined();
    expect(EventLoopMonitor.stallMs({ ...asleep, activeMs: 600_000 })).toBe(599_000);
  });

  it.effect("records a stall as a warning span, skipping the startup window", () => {
    const records: Array<LocalTrace.TraceRecord> = [];
    const tracer = LocalTrace.makeLocalFileTracer({ push: (record) => records.push(record) });
    const sampler = Effect.succeed(Effect.succeed(stalled));
    return Effect.gen(function* () {
      yield* TestClock.adjust("30 seconds");
      expect(records).toEqual([]);
      yield* TestClock.adjust("30 seconds");
      expect(records.map((r) => [r.name, r.attributes["delayMaxMs"], r.events[0]?.name])).toEqual([
        ["service.eventLoop.stall", 4_950, "event loop stalled for 4950 ms"],
      ]);
    }).pipe(
      Effect.provide(
        EventLoopMonitor.layerWith(sampler).pipe(
          Layer.provide(Layer.succeed(Tracer.Tracer)(tracer)),
        ),
      ),
    );
  });
});

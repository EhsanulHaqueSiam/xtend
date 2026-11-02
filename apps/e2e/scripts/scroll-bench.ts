// @effect-diagnostics globalConsole:off -- a dev CLI: it prints a table for a person.
// How Home's infinite scroll feels and what it costs in memory, on the built desktop with mock X as
// the engine (no X account). A reader scrolls For you at a steady pace through every page while X
// answers each read after a delay; the bench records how long they sat at the list's end waiting
// for X, the frames, and each process's memory before and after.
//   pnpm bench:scroll                                   build, then 3 runs
//   pnpm bench:scroll --no-build --runs 1 --speed 3000
//   pnpm bench:scroll --out before.json   ...   pnpm bench:scroll --compare before.json
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import buildDesktop from "../src/engine/globalSetup.ts";
import { startEngine } from "../src/engine/harness.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    pages: { type: "string", default: "15" },
    "page-size": { type: "string", default: "20" },
    latency: { type: "string", default: "800" },
    speed: { type: "string", default: "2000" },
    "photo-every": { type: "string", default: "2" },
    build: { type: "boolean", default: true },
    out: { type: "string" },
    compare: { type: "string" },
  },
  allowNegative: true,
});
const pages = Number(values.pages);
const pageSize = Number(values["page-size"]);
const latencyMs = Number(values.latency);
const speed = Number(values.speed);
const photoEvery = Number(values["photo-every"]);

interface Memory {
  /** Working set of every Electron process, in MB. */
  readonly totalMb: number;
  /** The app window's renderer and the x.com webview's, in MB. */
  readonly appMb: number;
  readonly engineMb: number;
  /** JS heap after a full GC, in MB. */
  readonly appHeapMb: number;
  readonly engineHeapMb: number;
  readonly appNodes: number;
  readonly engineNodes: number;
}

interface Run {
  readonly durationMs: number;
  /** Time pinned at the list's end, waiting for X's next page. */
  readonly stallMs: number;
  /** Waits at the end of 100ms or more: the ones a reader feels. */
  readonly stalls: number;
  readonly longestStallMs: number;
  readonly frameP95Ms: number;
  /** Frames over 50ms: visible jank. */
  readonly longFrames: number;
  /** Next-page reads X answered: pages - 1 when nothing was fetched twice. */
  readonly pageReads: number;
  readonly peakTotalMb: number;
  readonly before: Memory;
  readonly after: Memory;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
const median = (xs: ReadonlyArray<number>) => {
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
};

async function run(): Promise<Run> {
  const e = await startEngine({ forYouPages: pages, pageSize, latencyMs, photoEvery });
  try {
    // An occluded window would throttle its frames and skew the frame and stall numbers.
    await e.electron.evaluate(({ webContents }) => {
      for (const c of webContents.getAllWebContents()) c.setBackgroundThrottling(false);
    });

    /** Each process's working set, keyed by role, in KB. */
    const processes = () =>
      e.electron.evaluate(({ app, webContents }) => {
        const pid = (type: string) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getType() === type && !c.isDestroyed())
            ?.getOSProcessId();
        const metrics = app.getAppMetrics();
        const of = (p: number | undefined) =>
          metrics.find((m) => m.pid === p)?.memory.workingSetSize ?? 0;
        return {
          total: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0),
          app: of(pid("window")),
          engine: of(pid("webview")),
        };
      });

    const memory = async (): Promise<Memory> => {
      // A full GC first, so the heap is what the screens hold, not garbage not yet collected.
      const heaps = await e.electron.evaluate(async ({ webContents }) => {
        const heap = async (type: string) => {
          const c = webContents
            .getAllWebContents()
            .find((w) => w.getType() === type && !w.isDestroyed());
          if (c === undefined) return { used: 0, nodes: 0 };
          // The desktop's capture already holds the webview's debugger; share it, never detach it.
          const attached = c.debugger.isAttached();
          if (!attached) c.debugger.attach("1.3");
          try {
            await c.debugger.sendCommand("HeapProfiler.collectGarbage");
            const usage = (await c.debugger.sendCommand("Runtime.getHeapUsage")) as {
              usedSize: number;
            };
            const nodes = (await c.executeJavaScript(
              "document.getElementsByTagName('*').length",
            )) as number;
            return { used: usage.usedSize, nodes };
          } finally {
            if (!attached) c.debugger.detach();
          }
        };
        return { app: await heap("window"), engine: await heap("webview") };
      });
      const p = await processes();
      return {
        totalMb: mb(p.total * 1024),
        appMb: mb(p.app * 1024),
        engineMb: mb(p.engine * 1024),
        appHeapMb: mb(heaps.app.used),
        engineHeapMb: mb(heaps.engine.used),
        appNodes: heaps.app.nodes,
        engineNodes: heaps.engine.nodes,
      };
    };

    await e.app.evaluate(() => void (location.hash = "#/home?feed=forYou"));
    const first = e.mock.state.feed("forYou")[0]!;
    await e.app.locator(`main article[data-post="${first}"]`).waitFor({ timeout: 20_000 });
    // The first page has drawn and its images settled before the baseline.
    await e.app.waitForTimeout(1500);
    const before = await memory();

    const last = e.mock.state.feedPageIds("forYou", pages).at(-1)!;
    let peak = 0;
    const sampler = setInterval(() => {
      void processes().then(
        (p) => (peak = Math.max(peak, p.total)),
        () => undefined,
      );
    }, 500);
    const scrolled = await e.app.evaluate(
      ({ speed, last, limitMs }) =>
        new Promise<{
          durationMs: number;
          stallMs: number;
          stalls: number;
          longestStallMs: number;
          frames: Array<number>;
        }>((done, fail) => {
          const s = document.querySelector<HTMLElement>("main [data-virtuoso-scroller]");
          if (s === null) return fail(new Error("no list scroller"));
          const start = performance.now();
          let prev = start;
          let position = s.scrollTop;
          let waiting = 0;
          const out = { stallMs: 0, stalls: 0, longestStallMs: 0, frames: [] as Array<number> };
          const endWait = () => {
            if (waiting === 0) return;
            out.stallMs += waiting;
            if (waiting >= 100) out.stalls++;
            out.longestStallMs = Math.max(out.longestStallMs, waiting);
            waiting = 0;
          };
          const tick = (now: number) => {
            const dt = now - prev;
            prev = now;
            out.frames.push(dt);
            if (document.querySelector(`main article[data-post="${last}"]`) !== null) {
              endWait();
              return done({ ...out, durationMs: now - start });
            }
            if (now - start > limitMs) return fail(new Error("X's last page never arrived"));
            const end = s.scrollHeight - s.clientHeight;
            // A reader keeps their pace; at the end the wheel meets the bottom until more arrives.
            position = Math.min(position + (speed * dt) / 1000, end);
            if (position >= end - 1) waiting += dt;
            else endWait();
            s.scrollTop = position;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { speed, last, limitMs: 30_000 + pages * (latencyMs + 5_000) },
    );
    clearInterval(sampler);
    const pageReads = e.mock.reads.filter(
      (r) => r.op === "HomeTimeline" && typeof r.variables.cursor === "string",
    ).length;
    await e.app.waitForTimeout(1500);
    const after = await memory();
    const frames = scrolled.frames.toSorted((a, b) => a - b);
    return {
      durationMs: Math.round(scrolled.durationMs),
      stallMs: Math.round(scrolled.stallMs),
      stalls: scrolled.stalls,
      longestStallMs: Math.round(scrolled.longestStallMs),
      frameP95Ms: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
      longFrames: frames.filter((f) => f > 50).length,
      pageReads,
      peakTotalMb: mb(Math.max(peak, 0) * 1024),
      before,
      after,
    };
  } finally {
    await e.close();
  }
}

type Summary = Readonly<Record<string, number>>;
const summarize = (runs: ReadonlyArray<Run>): Summary => {
  const m = (pick: (r: Run) => number) => median(runs.map(pick));
  return {
    "stall ms": m((r) => r.stallMs),
    "stalls >=100ms": m((r) => r.stalls),
    "longest stall ms": m((r) => r.longestStallMs),
    "scroll ms": m((r) => r.durationMs),
    "frame p95 ms": m((r) => r.frameP95Ms),
    "frames >50ms": m((r) => r.longFrames),
    "page reads": m((r) => r.pageReads),
    "total MB before": m((r) => r.before.totalMb),
    "total MB after": m((r) => r.after.totalMb),
    "total MB peak": m((r) => r.peakTotalMb),
    "app MB after": m((r) => r.after.appMb),
    "engine MB after": m((r) => r.after.engineMb),
    "app heap MB before": m((r) => r.before.appHeapMb),
    "app heap MB after": m((r) => r.after.appHeapMb),
    "engine heap MB after": m((r) => r.after.engineHeapMb),
    "app DOM nodes after": m((r) => r.after.appNodes),
    "engine DOM nodes after": m((r) => r.after.engineNodes),
  };
};

if (values.build) buildDesktop();
const runs: Array<Run> = [];
for (let i = 0; i < Number(values.runs); i++) {
  const r = await run();
  runs.push(r);
  console.log(
    `run ${i + 1}: stalled ${r.stallMs}ms over ${r.stalls} waits (longest ${r.longestStallMs}ms), ` +
      `${r.durationMs}ms to read ${pages} pages, ${r.longFrames} long frames, ` +
      `memory ${r.before.totalMb} -> ${r.after.totalMb} MB`,
  );
}
const summary = summarize(runs);
const setup = { pages, pageSize, latencyMs, speed, photoEvery, runs: runs.length };
const commit = NodeChildProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim();
const result = { commit, setup, summary, runs };
const out =
  values.out ??
  NodePath.join(
    NodeOS.homedir(),
    "Pictures",
    "xtend-ui",
    "bench",
    "scroll",
    `${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
NodeFS.writeFileSync(out, JSON.stringify(result, null, 2));

const base =
  values.compare === undefined
    ? undefined
    : (JSON.parse(NodeFS.readFileSync(values.compare, "utf8")) as { summary: Summary });
console.log(
  `\n${pages} pages of ${pageSize} (a photo every ${photoEvery}), X answers in ${latencyMs}ms, reader at ${speed}px/s, median of ${runs.length}\n`,
);
console.log(
  base === undefined
    ? "| metric | value |\n|---|---|"
    : "| metric | before | after |\n|---|---|---|",
);
for (const [k, v] of Object.entries(summary))
  console.log(
    base === undefined ? `| ${k} | ${v} |` : `| ${k} | ${base.summary[k] ?? "-"} | ${v} |`,
  );
console.log(`\n${out}`);

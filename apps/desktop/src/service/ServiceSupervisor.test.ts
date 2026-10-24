import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { superviseService } from "./ServiceSupervisor.ts";

/** Every service child the supervisor spawned, with what it was started with and the signals it got. */
const children = vi.hoisted(() => [] as Array<FakeChild>);
class FakeChild extends EventEmitter {
  readonly killed: Array<string> = [];
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: ReadonlyArray<unknown>;
  constructor(args: ReadonlyArray<string>, env: NodeJS.ProcessEnv, stdio: ReadonlyArray<unknown>) {
    super();
    this.args = args;
    this.env = env;
    this.stdio = stdio;
  }
  kill(signal: string) {
    this.killed.push(signal);
  }
}

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("node:child_process", () => ({
  // No launchd agent loaded.
  spawnSync: () => ({ status: 1 }),
  spawn: (
    _node: string,
    args: Array<string>,
    options: { env: NodeJS.ProcessEnv; stdio: ReadonlyArray<unknown> },
  ) => {
    const child = new FakeChild(args, options.env, options.stdio);
    children.push(child);
    return child;
  },
}));

let baseDir: string;
let healthy: boolean;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xtend-supervisor-"));
  children.length = 0;
  healthy = false;
  vi.stubGlobal("fetch", async () => {
    if (!healthy) throw new TypeError("fetch failed");
    return new Response("{}");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(baseDir, { recursive: true, force: true });
});

it("runs the service as a child, restarts it with backoff, and starts none once quit began", async () => {
  const supervising = superviseService({
    serviceUrl: "http://127.0.0.1:4891",
    remote: false,
    baseDir,
    devUrl: undefined,
    log: () => {},
  });
  await vi.waitFor(() => expect(children).toHaveLength(1));
  healthy = true;
  const supervision = await supervising;
  vi.useFakeTimers();
  expect(supervision.mode).toBe("child");
  expect(children[0]!.args.slice(1)).toEqual(["--base-dir", baseDir, "--port", "4891"]);
  expect(children[0]!.env).toMatchObject({ ELECTRON_RUN_AS_NODE: "1", XTEND_SUPERVISOR: "child" });
  // The child exits when its stdin closes; only a pipe closes when this process dies.
  expect(children[0]!.stdio[0]).toBe("pipe");

  children[0]!.emit("exit", 1, null);
  vi.advanceTimersByTime(1_999);
  expect(children).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(children).toHaveLength(2);

  // A child that could not start reports an error, and may exit too; that is one restart, not two.
  children[1]!.emit("error", new Error("spawn EACCES"));
  children[1]!.emit("exit", null, null);
  vi.advanceTimersByTime(5_000);
  expect(children).toHaveLength(3);

  // Quit while a restart is pending: the timer must not leave a service running behind the app.
  children[2]!.emit("exit", 1, null);
  supervision.stop();
  vi.advanceTimersByTime(60_000);
  expect(children).toHaveLength(3);
  expect(children[2]!.killed).toEqual(["SIGTERM"]);
});

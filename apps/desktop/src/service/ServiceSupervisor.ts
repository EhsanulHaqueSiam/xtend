import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { app } from "electron";

import { decide, nextRestart, type ServiceMode } from "./supervision.ts";

const HEALTH_TIMEOUT_MS = 1_500;
const START_TIMEOUT_MS = 30_000;
const LAUNCHD_LABEL = "com.xtend.service";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface SupervisorOptions {
  readonly serviceUrl: string;
  /** The URL came from the desktop's saved remote config. */
  readonly remote: boolean;
  readonly baseDir: string;
  /** Dev only: the Vite origin the child must trust and redirect to. */
  readonly devUrl: string | undefined;
  readonly log: (message: string, detail?: unknown) => void;
}

export interface Supervision {
  readonly mode: ServiceMode;
  /** Kills a child we spawned; nothing else is ours to stop. */
  readonly stop: () => void;
}

const healthy = async (serviceUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(new URL("/api/health", serviceUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const launchdLoaded = () =>
  process.platform === "darwin" &&
  NodeChildProcess.spawnSync("launchctl", [
    "print",
    `gui/${NodeOS.userInfo().uid}/${LAUNCHD_LABEL}`,
  ]).status === 0;

/** The service entry: the bundle next to the app's resources, or the source tree in dev. */
const serviceEntry = () =>
  app.isPackaged
    ? NodePath.join(process.resourcesPath, "apps", "server", "dist", "bin.mjs")
    : NodePath.resolve(import.meta.dirname, "..", "..", "server", "src", "bin.ts");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForHealth(serviceUrl: string, deadline: number): Promise<boolean> {
  if (await healthy(serviceUrl)) return true;
  if (Date.now() >= deadline) return false;
  await sleep(500);
  return waitForHealth(serviceUrl, deadline);
}

/**
 * Makes sure a service answers on the configured URL before the window opens:
 * a remote URL is only probed, a launchd agent is waited for, and otherwise the
 * service runs as a child of this process, restarted with backoff until quit.
 */
export async function superviseService(options: SupervisorOptions): Promise<Supervision> {
  const url = new URL(options.serviceUrl);
  const probe = {
    remote: options.remote,
    reachable: await healthy(options.serviceUrl),
    loopback: LOCAL_HOSTS.has(url.hostname),
    launchdLoaded: launchdLoaded(),
  };
  const decision = decide(probe);
  options.log("service probe", { ...probe, ...decision });
  if (!decision.spawn) {
    if (!probe.reachable) await waitForHealth(options.serviceUrl, Date.now() + START_TIMEOUT_MS);
    return { mode: decision.mode, stop: () => {} };
  }

  // First launch: the state dir does not exist yet, and the log lives in it.
  NodeFS.mkdirSync(options.baseDir, { recursive: true });
  const logFile = NodeFS.openSync(NodePath.join(options.baseDir, "service.log"), "a");
  let child: NodeChildProcess.ChildProcess | undefined;
  let stopping = false;
  let attempt = 0;
  // Electron is a Node runtime too, so a user without node on PATH still gets a service.
  const node = process.env.XTEND_NODE ?? process.execPath;
  const start = () => {
    // A restart timer can still fire after quit began; a child started then would outlive the app.
    if (stopping) return;
    const startedAt = Date.now();
    child = NodeChildProcess.spawn(
      node,
      [
        serviceEntry(),
        "--base-dir",
        options.baseDir,
        "--port",
        url.port || "4820",
        ...(options.devUrl === undefined ? [] : ["--dev-url", options.devUrl]),
      ],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", XTEND_SUPERVISOR: "child" },
        // The child exits when this pipe closes, so a crash here cannot orphan it on our port.
        stdio: ["pipe", logFile, logFile],
      },
    );
    options.log("service child started", { pid: child.pid });
    let ended = false;
    const restart = (detail: Record<string, unknown>) => {
      if (stopping || ended) return;
      ended = true;
      const next = nextRestart(attempt, Date.now() - startedAt);
      attempt = next.attempt;
      options.log("service child exited, restarting", { ...detail, in: next.delayMs });
      setTimeout(start, next.delayMs);
    };
    child.once("exit", (code, signal) => restart({ code, signal }));
    // A spawn failure (bad XTEND_NODE) emits only `error`; unhandled, it would crash the main process.
    child.once("error", (error) => restart({ error: String(error) }));
  };
  start();
  if (!(await waitForHealth(options.serviceUrl, Date.now() + START_TIMEOUT_MS)))
    options.log("service child did not answer in time; see service.log", options.baseDir);
  return {
    mode: "child",
    stop: () => {
      stopping = true;
      child?.kill("SIGTERM");
    },
  };
}

import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { ObservationBatch, WsRpcGroup } from "@xtend/contracts";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { type Locator, chromium } from "playwright";

import { startFakeTreg } from "./fakeTreg.ts";

export { CHARGE, SEARCH_HIT } from "./fakeTreg.ts";

const ROOT = NodeURL.fileURLToPath(new URL("../../../", import.meta.url));

/** The palette chord, as the user presses it on this platform. */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

// shortcut: the port is free when probed, not reserved, so another process could take it before the
// service binds; that fails startup loudly. Upgrade if it ever flakes: have the service report its port.
const freePort = async () => {
  const probe = NodeNet.createServer().listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(probe, "listening");
  const { port } = probe.address() as NodeNet.AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

type Rpcs = RpcGroup.Rpcs<typeof WsRpcGroup>;
type Method = Rpc.Tag<Rpcs>;
type RpcOf<M extends Method> = Rpc.ExtractTag<Rpcs, M>;

/**
 * Runs `launch` in a fresh temp dir. Everything startup acquires is undone in reverse on close
 * and also when startup fails partway, so a failed launch leaves no process or temp dir behind;
 * one failing step does not skip the rest.
 */
export async function withTempDir<A>(
  prefix: string,
  launch: (dir: string, undo: Array<() => Promise<unknown>>) => Promise<A>,
) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix));
  const undo: Array<() => Promise<unknown>> = [
    () => NodeFSP.rm(dir, { recursive: true, force: true }),
  ];
  const close = async () => {
    for (const step of undo.toReversed()) await step().catch(() => undefined);
  };
  try {
    return { ...(await launch(dir, undo)), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * The real service on a temp base dir and free port, talking to a fake treg, plus a headless
 * Chromium page on the web app it serves. One per test file; `close` removes all of it.
 */
export const startApp = () =>
  withTempDir("xtend-e2e-", async (dir, undo) => {
    const service = await startService(dir, undo);
    const browser = await chromium.launch();
    undo.push(() => browser.close());
    const context = await browser.newContext({
      baseURL: service.url,
      viewport: { width: 1440, height: 900 },
    });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    return { page, treg: service.treg, rpc: service.rpc, observe: service.observe };
  });

/** The service and its fake treg, each registered in `undo` before the next step can fail. */
export async function startService(dir: string, undo: Array<() => Promise<unknown>>) {
  const baseDir = NodePath.join(dir, "state");
  const treg = await startFakeTreg();
  undo.push(treg.close);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let logs = "";
  const service = NodeChildProcess.spawn(
    process.execPath,
    [NodePath.join(ROOT, "apps/server/src/bin.ts"), "--base-dir", baseDir, "--port", String(port)],
    {
      env: {
        ...process.env,
        // So nothing falls back to the real ~/.xtend, ~/.treg or a model login.
        HOME: dir,
        XTEND_HOME: baseDir,
        XTEND_TREG_URL: treg.url,
        XTEND_POOL_URL: treg.url,
        XTEND_TREG_TOKEN: "test",
        // A child stops when its stdin closes, so a crashed test worker leaves no service behind.
        XTEND_SUPERVISOR: "child",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  service.stdout.on("data", (chunk) => (logs += chunk));
  service.stderr.on("data", (chunk) => (logs += chunk));
  const exited = NodeEvents.EventEmitter.once(service, "exit");
  undo.push(async () => {
    service.kill();
    await exited;
  });

  const deadline = Date.now() + 30_000;
  // Each probe has its own timeout, so one stuck request cannot use up the startup deadline.
  const healthy = () =>
    fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) }).then(
      (r) => r.ok,
      () => false,
    );
  while (!(await healthy())) {
    if (service.exitCode !== null || Date.now() > deadline)
      throw new Error(`service did not come up:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const token = (await NodeFSP.readFile(NodePath.join(baseDir, "auth-token"), "utf8")).trim();
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response;
  };

  /** What the client, CLI and MCP tools reach: `POST /api/rpc/<method>`, typed by the contracts. */
  const rpc = async <M extends Method>(
    method: M,
    payload: Rpc.Payload<RpcOf<M>>,
  ): Promise<Rpc.SuccessEncoded<RpcOf<M>>> => (await post(`/api/rpc/${method}`, payload)).json();

  /** What the desktop's capture pipeline posts. */
  const observe = async (batch: ObservationBatch) => {
    await post("/api/observations", batch);
  };

  return { url, baseDir, token, treg, rpc, observe };
}

export type App = Awaited<ReturnType<typeof startApp>>;

/** Picks an option in the app's own dropdown (ui/select.tsx), which is no native `<select>`. */
export async function choose(trigger: Locator, label: string) {
  await trigger.click();
  await trigger.page().getByRole("option", { name: label, exact: true }).click();
}

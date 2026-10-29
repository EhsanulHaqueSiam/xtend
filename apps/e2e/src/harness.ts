import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ObservationBatch, WsRpcGroup } from "@xtend/contracts";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The palette chord, as the user presses it on this platform. */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** One request the service sent to treg. */
interface TregCall {
  readonly method: string;
  /** What follows `/call/`: a catalog id or an own-account path such as `x/2/tweets`. */
  readonly endpoint: string;
  readonly body: unknown;
}

/**
 * What the fake bills, deliberately off the rate card: a meter that moves by these
 * amounts read treg's cost header, not the price quoted before the call.
 */
export const CHARGE = { post: 0.25, search: 0.002 } as const;

/** The one search result, as anyapi sends it (XClient's postFromAnyapi reads this shape). */
export const SEARCH_HIT = {
  id: "1990000000000000001",
  url: "https://x.com/builder/status/1990000000000000001",
  text: "Ship small, ship daily. Compounding does the rest.",
  createdAt: "2026-10-20T09:00:00.000Z",
  authorId: "42",
  authorUsername: "builder",
  authorName: "Builder",
  authorFollowers: 12000,
  viewCount: 50000,
  likeCount: 900,
  retweetCount: 80,
  replyCount: 40,
  quoteCount: 5,
  bookmarkCount: 120,
};

/**
 * treg for the endpoints the journeys use, answering in the shapes XClient parses and billing
 * through the `x-treg-cost-usd` header Treg.costOf reads. Anything else is a 404, and every
 * request is recorded so a test can assert what was, and was not, paid for.
 */
async function startFakeTreg() {
  const calls: Array<TregCall> = [];
  /** The post ids X "returned", in order, so a test checks the app against X rather than itself. */
  const posted: Array<string> = [];
  let nextPostId = 1990000000000000100n;
  const answer = (call: TregCall) => {
    if (call.method === "POST" && call.endpoint === "x/2/tweets") {
      posted.push(String(nextPostId++));
      return { status: 201, cost: CHARGE.post, body: { data: { id: posted.at(-1) } } };
    }
    if (call.method === "POST" && call.endpoint === "anyapi.x.search.posts")
      return {
        status: 200,
        cost: CHARGE.search,
        body: { output: { data: { items: [SEARCH_HIT], nextCursor: null } } },
      };
    return { status: 404, cost: 0, body: { error: `not faked: ${call.method} ${call.endpoint}` } };
  };
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://treg");
    // XTEND_POOL_URL points here too, so no journey reads or writes the shared pool.
    const pool = POOL_ANSWERS[pathname];
    if (pool !== undefined) return void response.end(JSON.stringify(pool));
    // Only the service's /call/ requests count: other local processes probe a reused port too.
    if (!pathname.startsWith("/call/")) return void response.writeHead(404).end();
    let text = "";
    for await (const chunk of request) text += chunk;
    const call: TregCall = {
      method: request.method ?? "GET",
      endpoint: pathname.slice("/call/".length),
      body: text === "" ? null : JSON.parse(text),
    };
    calls.push(call);
    const { status, cost, body } = answer(call);
    response.writeHead(status, {
      "content-type": "application/json",
      "x-treg-cost-usd": String(cost),
    });
    response.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    posted,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The pool worker's answers, empty: an install id, accepted pushes and no trends. */
const POOL_ANSWERS: Record<string, unknown> = {
  "/register": { installId: "e2e" },
  "/push": {},
  "/trends/hot": { posts: 0, installs: 0, rows: [] },
  "/trends/rising": { rows: [] },
};

// shortcut: the port is free when probed, not reserved, so another process could take it before the
// service binds; that fails startup loudly. Upgrade if it ever flakes: have the service report its port.
const freePort = async () => {
  const probe = createNetServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

type Rpcs = RpcGroup.Rpcs<typeof WsRpcGroup>;
type Method = Rpc.Tag<Rpcs>;
type RpcOf<M extends Method> = Rpc.ExtractTag<Rpcs, M>;

/**
 * The real service on a temp base dir and free port, talking to a fake treg, plus a headless
 * Chromium page on the web app it serves. One per test file; `close` removes all of it.
 */
export async function startApp() {
  const dir = await mkdtemp(join(tmpdir(), "xtend-e2e-"));
  // Everything startup acquires, undone in reverse on close and also when startup fails partway,
  // so a failed launch leaves no service, fake treg or temp dir behind; one failing step does not
  // skip the rest.
  const undo: Array<() => Promise<unknown>> = [() => rm(dir, { recursive: true, force: true })];
  const close = async () => {
    // eslint-disable-next-line no-await-in-loop -- in reverse order: the browser goes before the service it talks to.
    for (const step of undo.toReversed()) await step().catch(() => undefined);
  };
  try {
    return { ...(await launch(dir, undo)), close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Starts each piece in order, registering how to undo it before the next step can fail. */
async function launch(dir: string, undo: Array<() => Promise<unknown>>) {
  const baseDir = join(dir, "state");
  const treg = await startFakeTreg();
  undo.push(treg.close);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  let logs = "";
  const service = spawn(
    process.execPath,
    [join(ROOT, "apps/server/src/bin.ts"), "--base-dir", baseDir, "--port", String(port)],
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
  const exited = once(service, "exit");
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
  // Polling is sequential by nature.
  /* eslint-disable no-await-in-loop */
  while (!(await healthy())) {
    if (service.exitCode !== null || Date.now() > deadline)
      throw new Error(`service did not come up:\n${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  /* eslint-enable no-await-in-loop */
  const token = (await readFile(join(baseDir, "auth-token"), "utf8")).trim();
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

  const browser = await chromium.launch();
  undo.push(() => browser.close());
  const context = await browser.newContext({
    baseURL: url,
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(10_000);
  const page = await context.newPage();

  return { page, treg, rpc, observe };
}

export type App = Awaited<ReturnType<typeof startApp>>;

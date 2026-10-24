// Boots the built desktop against a throwaway state dir and port and checks the whole start
// path: Electron starts, the supervisor's child service answers, the window renders the
// web app, and its x.com webview loads. Needs `pnpm build` first (web dist, desktop pack).
// Linux CI runs it under xvfb-run. Fails on module or uncaught errors in the output too.
//   node scripts/smoke-test.mjs
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const DEADLINE_MS = 60_000;
const FATAL = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
  "Unable to load preload script",
];

const desktopDir = NodePath.resolve(import.meta.dirname, "..");
const electron = NodeModule.createRequire(import.meta.url)("electron");

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [servicePort, debugPort] = [await freePort(), await freePort()];
const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-smoke-"));
const serviceUrl = `http://127.0.0.1:${servicePort}`;

const env = {
  ...process.env,
  XTEND_HOME: NodePath.join(home, "service"),
  XTEND_USER_DATA: NodePath.join(home, "user-data"),
  XTEND_SERVICE_URL: serviceUrl,
  XTEND_REMOTE_DEBUG: String(debugPort),
  ELECTRON_ENABLE_LOGGING: "1",
  ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
};
// The built app is the subject: the service serves apps/web/dist, not the Vite dev server.
delete env.XTEND_DEV_URL;

let output = "";
// Its own process group, so the service child goes down with it.
const child = NodeChildProcess.spawn(electron, [desktopDir], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
  env,
});
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
let exited = false;
child.once("exit", () => (exited = true));

const getJson = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

/** One Runtime.evaluate over the page's DevTools socket. */
const evaluate = (target, expression) =>
  new Promise((resolve) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const done = (value) => {
      socket.close();
      resolve(value);
    };
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      ),
    );
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) done(message.result?.result?.value);
    });
    socket.addEventListener("error", () => done(undefined));
  });

const checks = { service: false, appRendered: false, xLoaded: false };
const started = Date.now();
/** Polls once a second until every check passed, Electron exited or the deadline passed. */
const poll = async () => {
  if (exited || Date.now() - started > DEADLINE_MS || Object.values(checks).every(Boolean)) return;
  await sleep(1_000);
  checks.service ||= (await getJson(`${serviceUrl}/api/health`)) !== null;
  const targets = (await getJson(`http://127.0.0.1:${debugPort}/json`)) ?? [];
  const pages = targets.filter((t) => t.type === "page");
  const app = pages.find((t) => t.url.startsWith(serviceUrl));
  if (app !== undefined && !checks.appRendered) {
    checks.appRendered =
      (await evaluate(app, `(document.getElementById("root")?.childElementCount ?? 0) > 0`)) ===
      true;
  }
  // x.com is a <webview> guest of the app page, so DevTools lists it as its own target type.
  checks.xLoaded ||= targets.some(
    (t) =>
      (t.type === "webview" || t.type === "page") && /^https:\/\/(x|twitter)\.com\//.test(t.url),
  );
  return poll();
};
await poll();

try {
  process.kill(-child.pid, "SIGTERM");
} catch {}
await sleep(1_000);
try {
  process.kill(-child.pid, "SIGKILL");
} catch {}
NodeFS.rmSync(home, { recursive: true, force: true });

const fatal = FATAL.filter((pattern) => output.includes(pattern));
const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (fatal.length > 0 || failed.length > 0) {
  console.error("Desktop smoke test failed.");
  if (failed.length > 0) console.error(`Never reached: ${failed.join(", ")}`);
  if (fatal.length > 0) console.error(`Fatal output: ${fatal.join(", ")}`);
  console.error(`\nOutput:\n${output}`);
  process.exit(1);
}
console.log(`Desktop smoke test passed in ${Math.round((Date.now() - started) / 1000)}s.`);

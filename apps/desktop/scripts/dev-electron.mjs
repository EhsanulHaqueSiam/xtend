// Launches Electron against the dev web server after each pack. The previous
// instance is stopped by its own PID so a rebuild never kills another app.
// While it runs, <repo>/.xtend/dev-desktop.json names its PID and DevTools port for `pnpm dev:ps`.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

const require = NodeModule.createRequire(import.meta.url);
const electronBinary = require("electron");
const appDir = NodePath.resolve(import.meta.dirname, "..");
const recordFile = NodePath.resolve(appDir, "..", "..", ".xtend", "dev-desktop.json");

const child = NodeChildProcess.spawn(electronBinary, [appDir], {
  stdio: "inherit",
  env: {
    ...process.env,
    XTEND_DEV_URL: process.env.XTEND_DEV_URL ?? "http://localhost:5820",
    XTEND_SERVICE_URL: process.env.XTEND_SERVICE_URL ?? "http://127.0.0.1:4820",
  },
});
NodeFS.mkdirSync(NodePath.dirname(recordFile), { recursive: true });
NodeFS.writeFileSync(
  recordFile,
  JSON.stringify({
    pid: child.pid,
    remoteDebug: process.env.XTEND_REMOTE_DEBUG ?? null,
    userData: process.env.XTEND_USER_DATA ?? null,
    startedAt: new Date().toISOString(),
  }),
);
process.on("exit", () => {
  // A rebuild's next instance may have written its own record already.
  try {
    if (JSON.parse(NodeFS.readFileSync(recordFile, "utf8")).pid === child.pid)
      NodeFS.rmSync(recordFile);
  } catch {
    // Already gone.
  }
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill());
}

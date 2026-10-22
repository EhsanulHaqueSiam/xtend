// Launches Electron against the dev web server after each pack. The previous
// instance is stopped by its own PID so a rebuild never kills another app.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const appDir = path.resolve(import.meta.dirname, "..");

const child = spawn(electronBinary, [appDir], {
  stdio: "inherit",
  env: {
    ...process.env,
    XTEND_DEV_URL: process.env.XTEND_DEV_URL ?? "http://localhost:5820",
    XTEND_SERVICE_URL: process.env.XTEND_SERVICE_URL ?? "http://127.0.0.1:4820",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill());
}

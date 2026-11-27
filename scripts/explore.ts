// @effect-diagnostics globalConsole:off -- a dev CLI: it prints the trace path for a person.
// Property-based exploration of the web app with Bombadil: it clicks, types and navigates at
// random through a seeded service on a fake treg, and stops at the first state that breaks a
// property in scenarios/explore.spec.ts. Like the e2e journeys, nothing reaches X, treg or a model.

//   pnpm explore [--time 2m] [--headed] [-- <more bombadil browser test flags>]
//   exit 0 no violation in the time, 1 a violation or a Bombadil error (see its output and the
//   printed trace), 2 the app did not start
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { chromium } from "playwright";

import setup from "./scenarios/globalSetup.ts";
import { startService, withTempDir } from "./scenarios/harness.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const { values, positionals } = NodeUtil.parseArgs({
  allowPositionals: true,
  options: {
    time: { type: "string", default: "2m" },
    headed: { type: "boolean", default: false },
  },
});

const branch = NodeChildProcess.execFileSync("git", ["branch", "--show-current"], {
  cwd: root,
  encoding: "utf8",
}).trim();
// Outside the repo, like `pnpm capture`: the trace holds a screenshot of every state.
const trace = NodePath.join(
  NodeOS.homedir(),
  "Pictures",
  "xtend-ui",
  branch.replaceAll("/", "-") || "detached",
  `explore-${new Date().toISOString().replaceAll(":", "-")}.bin`,
);

const release = await setup();
const app = await withTempDir("xtend-explore-", async (dir, undo) => ({
  service: await startService(dir, undo, { seed: true }),
})).catch((error: unknown) => {
  release();
  console.error(`[explore] ${error instanceof Error ? error.message : String(error)}`);
  return process.exit(2);
});

NodeFS.mkdirSync(NodePath.dirname(trace), { recursive: true });
// Ctrl-C reaches Bombadil too; this process stays up to remove the service and its temp home.
process.on("SIGINT", () => {});
const bombadil = NodeChildProcess.spawn(
  NodePath.join(import.meta.dirname, "node_modules/.bin/bombadil"),
  [
    "browser",
    "test",
    ...(values.headed ? [] : ["--headless"]),
    "--exit-on-violation",
    `--time-limit=${values.time}`,
    "--width=1440",
    "--height=900",
    `--output-path=${trace}`,
    ...positionals,
    app.service.url,
    NodePath.join(import.meta.dirname, "scenarios/explore.spec.ts"),
  ],
  // The Chromium the scenarios use, so CI and every Mac explore with the same browser.
  { stdio: "inherit", env: { ...process.env, CHROME: chromium.executablePath() } },
);
const [code] = (await NodeEvents.EventEmitter.once(bombadil, "exit")) as [number | null];
await app.close();
release();
console.log(`\n[explore] trace: ${trace}`);
process.exit(code === 0 ? 0 : 1);

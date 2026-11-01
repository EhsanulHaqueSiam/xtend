// T3 Code runs this in the background for a new worktree (t3.json): installs from the lockfile.
// `.t3/setup-running` holds its PID until `.t3/setup-done` or `.t3/setup-failed` (with the install
// tail), so agents wait instead of racing it. Dev state (.xtend) is never copied, since two services
// on one database would post the same drafts; only a saved X session (dev-x-session.ts) is.

//   node scripts/setup-worktree.ts
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const worktree = NodePath.dirname(import.meta.dirname);
const markerDir = NodePath.join(worktree, ".t3");
const running = NodePath.join(markerDir, "setup-running");
const done = NodePath.join(markerDir, "setup-done");
const failed = NodePath.join(markerDir, "setup-failed");

NodeFS.rmSync(done, { force: true });
NodeFS.rmSync(failed, { force: true });
NodeFS.mkdirSync(markerDir, { recursive: true });
NodeFS.writeFileSync(running, `${process.pid}\n`);
let failureDetail = "";
process.on("exit", (code) => {
  if (code === 0) NodeFS.writeFileSync(done, "");
  else NodeFS.writeFileSync(failed, `Setup exited with code ${code}.\n${failureDetail}\n`);
  NodeFS.rmSync(running, { force: true });
});

// A cancelled setup must still leave a marker, or agents would wait forever. The signal goes
// on to the install, and setup exits when the install's output closes.
let cancelled: NodeJS.Signals | undefined;
const install = NodeChildProcess.spawn("pnpm install --frozen-lockfile", {
  cwd: worktree,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cancelled = signal;
    install.kill(signal);
  });
}
let tail = "";
for (const [source, target] of [
  [install.stdout, process.stdout],
  [install.stderr, process.stderr],
] as const) {
  source.setEncoding("utf8");
  source.on("data", (chunk: string) => {
    target.write(chunk);
    tail = (tail + chunk).slice(-8_000);
  });
}
const status = await new Promise<number | null>((resolve) => install.on("close", resolve));
if (status !== 0 || cancelled !== undefined) {
  failureDetail =
    cancelled !== undefined
      ? `Cancelled by ${cancelled}.`
      : tail.trimEnd().split("\n").slice(-30).join("\n");
  process.exit(status || 1);
}
// Spawned, not imported: the session script needs the packages the install just put in place.
if (NodeFS.existsSync(NodePath.join(NodeOS.homedir(), ".xtend-dev", "x-session"))) {
  const use = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(worktree, "scripts", "dev-x-session.ts"), "use"],
    { cwd: worktree, stdio: "inherit" },
  );
  // A worktree without the login still works; the dev desktop says how to sign in.
  if (use.status !== 0) console.error("[setup] could not copy the saved X session; continuing.");
}

// T3 Code runs this when it creates a worktree of Xtend (t3.json, runOnWorktreeCreate): it
// installs the workspace from the lockfile. It runs in the background, so agents can start
// before it ends: `.t3/setup-running` holds this PID until setup ends with `.t3/setup-done` or
// `.t3/setup-failed` (with the end of the install output), and agents wait instead of racing
// it with their own install. Dev state (.xtend) is per checkout and never copied: two services
// on one database would both run the scheduler and post the same drafts.
//   node scripts/setup-worktree.ts
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
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

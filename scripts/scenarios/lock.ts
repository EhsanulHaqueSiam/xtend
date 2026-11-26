import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * One scenario run per app checkout: each run builds that checkout's web app and desktop in place,
 * and two at once would serve each other half-written bundles. A second run fails at once, naming
 * the first; a lock whose process is gone is taken over. Other checkouts run side by side freely.
 * Returns the release, for a globalSetup to return as its teardown.
 */
export function lockAppDir(appDir: string) {
  const file = NodePath.join(appDir, "node_modules", ".cache", "xtend-scenarios.lock");
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  try {
    NodeFS.writeFileSync(file, String(process.pid), { flag: "wx" });
  } catch {
    const holder = Number(NodeFS.readFileSync(file, "utf8"));
    if (holder !== process.pid && alive(holder))
      throw new Error(
        `Another scenario run (pid ${holder}) is building ${appDir}. Wait for it to finish, or run ` +
          "this one from another worktree: every checkout gets its own ports, homes and Electron.",
      );
    NodeFS.writeFileSync(file, String(process.pid));
  }
  return () => {
    if (NodeFS.readFileSync(file, "utf8") === String(process.pid)) NodeFS.rmSync(file);
  };
}

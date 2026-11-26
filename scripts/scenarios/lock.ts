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

/** The pid a lock file names, or undefined once it is gone. */
const holderOf = (file: string) => {
  try {
    return Number(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/**
 * One scenario run per app checkout: each run builds that checkout's web app and desktop in place,
 * and two at once would serve each other half-written bundles. A second run fails at once, naming
 * the first. A lock whose process is gone is moved aside first, atomically, so of two runs finding
 * it stale only one takes it over. Other checkouts run side by side freely. Returns the release.
 */
export function lockAppDir(appDir: string) {
  const file = NodePath.join(appDir, "node_modules", ".cache", "xtend-scenarios.lock");
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const release = () => {
    if (holderOf(file) === process.pid) NodeFS.rmSync(file, { force: true });
  };
  const busy = (pid: number) =>
    new Error(
      `Another scenario run (pid ${pid}) is building ${appDir}. Wait for it to finish, or run ` +
        "this one from another worktree: every checkout gets its own ports, homes and Electron.",
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      NodeFS.writeFileSync(file, String(process.pid), { flag: "wx" });
      return release;
    } catch {}
    const holder = holderOf(file);
    // One vitest process running both scenario projects.
    if (holder === process.pid) return release;
    if (holder !== undefined && alive(holder)) throw busy(holder);
    const aside = `${file}.${process.pid}`;
    try {
      NodeFS.renameSync(file, aside);
    } catch {
      continue;
    }
    // Moved a lock another run took after we read the stale one: put it back, it is theirs.
    const moved = holderOf(aside);
    if (moved !== undefined && moved !== holder && alive(moved)) {
      NodeFS.renameSync(aside, file);
      throw busy(moved);
    }
    NodeFS.rmSync(aside, { force: true });
  }
  throw busy(holderOf(file) ?? 0);
}

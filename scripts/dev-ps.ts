// Lists every dev process of this repo across its git worktrees, from the records the dev runner
// (.xtend/dev-ports.json) and the dev desktop launcher (.xtend/dev-desktop.json) write at spawn
// and remove on exit. Print-only: stop a process from the terminal that started it, or by a PID
// listed here for your own checkout (AGENTS.md "Killing by pattern").

//   pnpm dev:ps
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** What `pnpm dev` records for its service and web server. */
export interface DevRecord {
  readonly service: number;
  readonly web: number;
  readonly home: string;
  readonly pid?: number;
  readonly startedAt?: string;
}

/** What the dev desktop launcher records for its Electron process. */
export interface DesktopRecord {
  readonly pid: number;
  readonly remoteDebug: string | null;
  readonly userData: string | null;
  readonly startedAt: string;
}

export const devRecordFile = (checkout: string) =>
  NodePath.join(checkout, ".xtend", "dev-ports.json");
export const desktopRecordFile = (checkout: string) =>
  NodePath.join(checkout, ".xtend", "dev-desktop.json");

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

export const readDevRecord = (checkout: string) => {
  const r = readJson(devRecordFile(checkout)) as Partial<DevRecord> | undefined;
  return typeof r?.service === "number" && typeof r.web === "number" ? (r as DevRecord) : undefined;
};

export const readDesktopRecord = (checkout: string) => {
  const r = readJson(desktopRecordFile(checkout)) as Partial<DesktopRecord> | undefined;
  return typeof r?.pid === "number" ? (r as DesktopRecord) : undefined;
};

/** True while `pid` exists; EPERM means it exists under another user. */
export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Every checkout of the repo `cwd` belongs to, the main one first. */
export const worktrees = (cwd: string): Array<string> =>
  NodeChildProcess.execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd,
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

export interface Row {
  readonly checkout: string;
  readonly kind: "dev" | "desktop";
  readonly pid: number | undefined;
  readonly ports: string;
  readonly devtools: string;
  readonly up: string;
  readonly state: "alive" | "dead" | "unknown";
}

const uptime = (startedAt: string | undefined, now: number) => {
  if (startedAt === undefined) return "?";
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return s < 3600
    ? `${Math.floor(s / 60)}m${s % 60}s`
    : `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};

/** One row per recorded process. A record without a PID predates this script and stays unknown. */
export function rows(
  checkouts: ReadonlyArray<string>,
  isAlive: (pid: number) => boolean,
  now: number,
): Array<Row> {
  const state = (pid: number | undefined): Row["state"] =>
    pid === undefined ? "unknown" : isAlive(pid) ? "alive" : "dead";
  return checkouts.flatMap((checkout) => {
    const dev = readDevRecord(checkout);
    const desktop = readDesktopRecord(checkout);
    return [
      ...(dev === undefined
        ? []
        : [
            {
              checkout,
              kind: "dev" as const,
              pid: dev.pid,
              ports: `service ${dev.service} web ${dev.web}`,
              devtools: "-",
              up: uptime(dev.startedAt, now),
              state: state(dev.pid),
            },
          ]),
      ...(desktop === undefined
        ? []
        : [
            {
              checkout,
              kind: "desktop" as const,
              pid: desktop.pid,
              ports: "-",
              devtools: desktop.remoteDebug ?? "-",
              up: uptime(desktop.startedAt, now),
              state: state(desktop.pid),
            },
          ]),
    ];
  });
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const found = rows(worktrees(root), alive, Date.now());
  if (found.length === 0) console.log("No dev processes recorded in any checkout of this repo.");
  const table = [
    ["", "checkout", "kind", "pid", "ports", "devtools", "up", "state"],
    ...found.map((r) => [
      r.checkout === root ? "*" : "",
      r.checkout,
      r.kind,
      String(r.pid ?? "?"),
      r.ports,
      r.devtools,
      r.up,
      r.state,
    ]),
  ];
  const widths = table[0]!.map((_, i) => Math.max(...table.map((row) => row[i]!.length)));
  if (found.length > 0)
    for (const row of table) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
  if (found.some((r) => r.state === "dead"))
    console.log("dead: the process crashed or was killed; its record is stale and harmless.");
}

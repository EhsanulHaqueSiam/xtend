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

export interface ProcessInfo {
  /** Epoch ms, to the second. */
  readonly start: number;
  readonly command: string;
}

/**
 * A process's start time and command line from `ps`: "gone" when the PID exists no more,
 * "unreadable" when `ps` failed or printed something this cannot parse.
 */
export const processInfo = (pid: number): ProcessInfo | "gone" | "unreadable" => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return "gone";
  }
  // lstart is only English, "Sun Nov  1 14:10:01 2026", in the C locale.
  const ps = NodeChildProcess.spawnSync("ps", ["-o", "lstart=,command=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return parsePs(ps.status === 0 ? ps.stdout : "");
};

/** One `ps -o lstart=,command=` line, or "unreadable". */
export const parsePs = (output: string): ProcessInfo | "unreadable" => {
  const match = /^\s*([A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(\S.*)$/.exec(
    output.trim(),
  );
  const start = match === null ? Number.NaN : new Date(match[1]!).getTime();
  return Number.isNaN(start) ? "unreadable" : { start, command: match![2]! };
};

/** How each kind of record's process shows in `ps`. */
export const COMMANDS = {
  dev: /dev-runner\.ts/,
  desktop: /electron|xtend/i,
} as const;

/**
 * Whether a recorded PID is still the process that wrote the record: running `command`, and
 * started shortly before `recordedAt`. After a crash the PID can belong to a stranger: stale.
 * Unknown when `ps` could not say; callers guarding a write treat that as held.
 */
export function verdict(
  info: ProcessInfo | "gone" | "unreadable",
  recordedAt: number,
  command: RegExp,
): "alive" | "dead" | "stale" | "unknown" {
  if (info === "gone") return "dead";
  if (info === "unreadable") return "unknown";
  const started = info.start <= recordedAt + 2_000 && info.start >= recordedAt - 120_000;
  return started && command.test(info.command) ? "alive" : "stale";
}

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
  readonly state: "alive" | "dead" | "stale" | "unknown";
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
  info: (pid: number) => ReturnType<typeof processInfo>,
  now: number,
): Array<Row> {
  const state = (
    pid: number | undefined,
    startedAt: string | undefined,
    command: RegExp,
  ): Row["state"] =>
    pid === undefined || startedAt === undefined
      ? "unknown"
      : verdict(info(pid), Date.parse(startedAt), command);
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
              state: state(dev.pid, dev.startedAt, COMMANDS.dev),
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
              state: state(desktop.pid, desktop.startedAt, COMMANDS.desktop),
            },
          ]),
    ];
  });
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const found = rows(worktrees(root), processInfo, Date.now());
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
  if (found.some((r) => r.state === "unknown"))
    console.log(
      "unknown: no PID recorded (an older run) or `ps` could not say which process it is.",
    );
  if (found.some((r) => r.state === "dead"))
    console.log("dead: the process crashed or was killed; its record is left over and harmless.");
  if (found.some((r) => r.state === "stale"))
    console.log(
      "stale: the PID now belongs to another process (other command or start time); not a dev process.",
    );
}

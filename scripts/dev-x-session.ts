// One signed-in x.com session for every dev desktop, as T3's reusable dev credential is one
// pairing cookie for every dev server. `save` keeps a copy outside every repo, `use` copies it
// into a checkout's dev desktop profile, both minus Chromium's caches (1.3 GB down to a few MB).
// The copy is the user's real X login: never commit it, attach it, or share it.

//   pnpm dev:x-session status
//   pnpm dev:x-session save [--from <checkout or user data dir> | --installed]   default: this checkout
//   pnpm dev:x-session use [--home <dir>]                                       default: the recorded home
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import { refuseLiveHome } from "../apps/server/scripts/devData.ts";
import {
  COMMANDS,
  processInfo,
  readDevRecord,
  verdict,
  worktrees,
  type ProcessInfo,
} from "./dev-ps.ts";

/** The shared copy: outside every checkout, and never ~/.xtend. */
export const SAVED = NodePath.join(NodeOS.homedir(), ".xtend-dev", "x-session");
// Account 1's partition (apps/desktop/src/window/guestPolicy.ts); a dev home starts with one account.
const PARTITION = NodePath.join("Partitions", "x-session");
const CACHES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Service Worker",
]);

/** The installed app's Electron profile: Electron's userData for the product name "Xtend". Read only. */
export const installedProfile = (platform = process.platform, home = NodeOS.homedir()) =>
  platform === "darwin"
    ? NodePath.join(home, "Library", "Application Support", "Xtend")
    : NodePath.join(process.env.XDG_CONFIG_HOME ?? NodePath.join(home, ".config"), "Xtend");

/** The dev desktop's user data for a home, as scripts/dev-runner.ts hands it to Electron. */
export const devUserData = (home: string) => NodePath.join(home, "electron");

export const partitionOf = (userData: string) => NodePath.join(userData, PARTITION);

/**
 * The PID holding a Chromium profile, from the SingletonLock symlink ("<host>-<pid>") Electron
 * makes in user data at start. A PID that is gone, or reused by a process that is not Electron
 * or started after the lock, holds nothing: the lock was left by a crash.
 */
export const profileHolder = (
  userData: string,
  info: (pid: number) => ProcessInfo | undefined = processInfo,
) => {
  const lock = NodePath.join(userData, "SingletonLock");
  let target: string;
  try {
    target = NodeFS.readlinkSync(lock);
  } catch {
    return undefined;
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  if (!Number.isInteger(pid)) return undefined;
  return verdict(info(pid), NodeFS.lstatSync(lock).mtimeMs, COMMANDS.desktop) === "alive"
    ? pid
    : undefined;
};

/** `path` with its nearest existing ancestor resolved, so a symlink anywhere above shows. */
const real = (path: string): string => {
  const resolved = NodePath.resolve(path);
  if (NodeFS.lstatSync(resolved, { throwIfNoEntry: false }) !== undefined)
    return NodeFS.realpathSync(resolved);
  const parent = NodePath.dirname(resolved);
  return parent === resolved ? resolved : NodePath.join(real(parent), NodePath.basename(resolved));
};

const within = (path: string, dir: string) =>
  path === dir || path.startsWith(`${dir}${NodePath.sep}`);

/** Profiles no copy may land in, by any path: the live install and the installed app's. */
const PROTECTED = () => [NodePath.join(NodeOS.homedir(), ".xtend"), installedProfile()];

/**
 * Throws unless `target` may be replaced: no step of `chain` (the directories this script makes
 * or replaces, down to `target`) is a symlink, and `target` resolves outside every protected dir.
 */
export function refuseDestination(
  target: string,
  chain: ReadonlyArray<string>,
  protectedDirs: ReadonlyArray<string> = PROTECTED(),
) {
  for (const step of [...chain, target])
    if (NodeFS.lstatSync(step, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`${step} is a symlink; refusing to write through it.`);
  const resolved = real(target);
  const hit = protectedDirs.find((dir) => within(resolved, real(dir)));
  if (hit !== undefined) throw new Error(`${target} is inside ${hit}; refusing to write there.`);
}

/** Every symlink under `dir`: a copy must hold files of its own, not links back to a live profile. */
const links = (dir: string): Array<string> =>
  NodeFS.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => NodePath.join(entry.parentPath, entry.name));

/**
 * Copies a partition without its caches into a staging dir beside `to`, refuses any symlink in
 * the copy, runs `accept` on it, and only then swaps it in. A failure at any step leaves `to` as
 * it was.
 */
export function copyPartition(
  from: string,
  to: string,
  accept: (staging: string) => void = () => {},
) {
  const source = NodeFS.realpathSync(from);
  if (!NodeFS.existsSync(NodePath.join(source, "Cookies")))
    throw new Error(`${from} has no Cookies file; is it an x.com partition?`);
  const staging = `${to}.copying`;
  const old = `${to}.old`;
  NodeFS.rmSync(staging, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true, mode: 0o700 });
  try {
    NodeFS.cpSync(source, staging, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (entry) => !CACHES.has(NodePath.basename(entry)),
    });
    const found = links(staging);
    if (found.length > 0)
      throw new Error(
        `${from} holds symlinks (${found.map((l) => NodePath.relative(staging, l)).join(", ")}); copy a profile of real files.`,
      );
    accept(staging);
  } catch (error) {
    NodeFS.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  NodeFS.rmSync(old, { recursive: true, force: true });
  if (NodeFS.existsSync(to)) NodeFS.renameSync(to, old);
  NodeFS.renameSync(staging, to);
  NodeFS.rmSync(old, { recursive: true, force: true });
}

/**
 * Copies the saved session into a dev desktop's profile, for `use`, `pnpm dev:desktop` and
 * worktree setup alike. Throws before touching anything when the profile is protected, reached
 * through a symlink, or held by a running desktop.
 */
export function useSaved(userData: string) {
  const partitions = NodePath.join(userData, "Partitions");
  refuseDestination(partitionOf(userData), [userData, partitions]);
  const holder = profileHolder(userData);
  if (holder !== undefined)
    throw new Error(`a desktop (PID ${holder}) holds ${userData}; quit it first.`);
  copyPartition(SAVED, partitionOf(userData));
  return partitionOf(userData);
}

/**
 * When X's login cookie in a partition expires, or undefined when it holds no login. Reads a
 * scratch copy: even a read-only open of a live profile's database can write its -shm file.
 */
export function loginExpiry(partition: string): Date | undefined {
  if (!NodeFS.existsSync(NodePath.join(partition, "Cookies"))) return undefined;
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-cookies-"));
  for (const name of NodeFS.readdirSync(partition).filter((n) => n.startsWith("Cookies")))
    NodeFS.copyFileSync(NodePath.join(partition, name), NodePath.join(scratch, name));
  const db = new NodeSqlite.DatabaseSync(NodePath.join(scratch, "Cookies"));
  try {
    const query = db.prepare(
      "SELECT max(expires_utc) AS expires FROM cookies WHERE name = 'auth_token' AND host_key LIKE '%x.com'",
    );
    // Chromium counts microseconds from 1601-01-01, past what a JS number holds exactly.
    query.setReadBigInts(true);
    const row = query.get() as { expires: bigint | null } | undefined;
    if (row?.expires == null) return undefined;
    return new Date(Number(row.expires / 1000n) - 11_644_473_600_000);
  } finally {
    db.close();
    NodeFS.rmSync(scratch, { recursive: true, force: true });
  }
}

const describe = (partition: string) => {
  const expiry = loginExpiry(partition);
  return expiry === undefined
    ? "signed out"
    : `signed in until ${expiry.toISOString().slice(0, 10)}`;
};

/** Where `--from` points: a checkout (its .xtend/electron) or a user data dir itself. */
const sourceProfile = (from: string) =>
  NodeFS.existsSync(partitionOf(from)) ? from : devUserData(NodePath.join(from, ".xtend"));

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const [command, ...rest] = process.argv.slice(2);
  const { values } = NodeUtil.parseArgs({
    args: rest,
    options: {
      from: { type: "string" },
      installed: { type: "boolean", default: false },
      home: { type: "string" },
    },
  });
  if (values.home !== undefined) refuseLiveHome(values.home);
  const home = NodePath.resolve(
    values.home ?? readDevRecord(root)?.home ?? NodePath.join(root, ".xtend"),
  );
  const here = process.env.XTEND_USER_DATA ?? devUserData(home);
  const fail = (why: string): never => {
    console.error(`[x-session] ${why}`);
    process.exit(1);
  };

  if (command === "status") {
    console.log(`saved   ${SAVED}: ${NodeFS.existsSync(SAVED) ? describe(SAVED) : "none"}`);
    console.log(`here    ${partitionOf(here)}: ${describe(partitionOf(here))}`);
    for (const checkout of worktrees(root).filter((c) => c !== root)) {
      const partition = partitionOf(devUserData(NodePath.join(checkout, ".xtend")));
      if (NodeFS.existsSync(partition)) console.log(`other   ${partition}: ${describe(partition)}`);
    }
  } else if (command === "save") {
    const from = values.installed
      ? installedProfile()
      : values.from === undefined
        ? here
        : sourceProfile(NodePath.resolve(values.from));
    if (!NodeFS.existsSync(partitionOf(from)))
      fail(
        `no x.com partition in ${from}. Sign in a dev desktop first, or pass --from <checkout> or --installed.`,
      );
    // A running desktop rewrites its cookies and storage while they are copied.
    const holder = profileHolder(from);
    if (holder !== undefined)
      fail(`${from} is in use by PID ${holder}; quit that desktop (or the app) first.`);
    try {
      refuseDestination(SAVED, [NodePath.dirname(SAVED)]);
      // Validates the copy, never the source: an installed app's profile is only read.
      copyPartition(partitionOf(from), SAVED, (staging) => {
        if (loginExpiry(staging) === undefined)
          throw new Error(`${from} is signed out of X; the saved session is unchanged.`);
      });
    } catch (error) {
      fail((error as Error).message);
    }
    NodeFS.chmodSync(NodePath.dirname(SAVED), 0o700);
    console.log(`[x-session] saved ${partitionOf(from)} -> ${SAVED} (${describe(SAVED)})`);
    console.log("[x-session] it is your real X login: never commit, attach or share it.");
  } else if (command === "use") {
    if (!NodeFS.existsSync(SAVED)) fail("nothing saved yet: pnpm dev:x-session save first.");
    try {
      const partition = useSaved(here);
      console.log(`[x-session] ${SAVED} -> ${partition} (${describe(partition)})`);
    } catch (error) {
      fail((error as Error).message);
    }
  } else {
    console.error(
      "usage: pnpm dev:x-session status | save [--from <checkout or user data dir> | --installed] | use [--home <dir>]",
    );
    process.exit(2);
  }
}

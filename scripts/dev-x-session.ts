// One signed-in x.com session for every dev desktop, as T3's reusable dev credential is one
// pairing cookie for every dev server. `save` keeps a copy outside every repo, `use` copies it
// into a checkout's dev desktop profile, both minus Chromium's caches (1.3 GB down to a few MB).
// The copy is the user's real X login: never commit it, attach it, or share it.

//   pnpm dev:x-session status
//   pnpm dev:x-session save [--from <checkout or user data dir> | --installed]   default: this checkout
//   pnpm dev:x-session use [--home <dir>]                                       default: the recorded home
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import { refuseLiveHome } from "../apps/server/scripts/devData.ts";
import { COMMANDS, processInfo, readDevRecord, verdict, worktrees } from "./dev-ps.ts";

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
 * or started after the lock, holds nothing: the lock was left by a crash. When `ps` cannot say,
 * the profile counts as held.
 */
export const profileHolder = (
  userData: string,
  info: (pid: number) => ReturnType<typeof processInfo> = processInfo,
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
  const state = verdict(info(pid), NodeFS.lstatSync(lock).mtimeMs, COMMANDS.desktop);
  return state === "alive" || state === "unknown" ? pid : undefined;
};

/** `path` through its nearest existing ancestor's canonical path: real case, no symlinks. */
const canonical = (path: string): string => {
  const resolved = NodePath.resolve(path);
  if (NodeFS.lstatSync(resolved, { throwIfNoEntry: false }) !== undefined)
    return NodeFS.realpathSync.native(resolved);
  const parent = NodePath.dirname(resolved);
  return parent === resolved
    ? resolved
    : NodePath.join(canonical(parent), NodePath.basename(resolved));
};

/**
 * Whether `path` is `dir` or under it. By identity: some existing ancestor of `path` is `dir`'s
 * inode, whatever case or link spells either. A `dir` that does not exist yet is compared by
 * canonical path, case-folded where the filesystem may ignore case.
 */
export function inside(path: string, dir: string): boolean {
  const target = NodeFS.statSync(dir, { throwIfNoEntry: false });
  if (target !== undefined) {
    for (let at = canonical(path); ; at = NodePath.dirname(at)) {
      const here = NodeFS.statSync(at, { throwIfNoEntry: false });
      if (here !== undefined && here.dev === target.dev && here.ino === target.ino) return true;
      if (NodePath.dirname(at) === at) return false;
    }
  }
  const fold = (p: string) =>
    process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
  const [a, b] = [fold(canonical(path)), fold(canonical(dir))];
  return a === b || a.startsWith(`${b}${NodePath.sep}`);
}

/** Profiles no copy may land in, by any path: the live install and the installed app's. */
const PROTECTED = () => [NodePath.join(NodeOS.homedir(), ".xtend"), installedProfile()];

/**
 * Throws unless `target` may be replaced: no step of `chain` (the directories this script makes
 * or replaces, down to `target`) is a symlink, and `target` is outside every protected dir.
 */
export function refuseDestination(
  target: string,
  chain: ReadonlyArray<string>,
  protectedDirs: ReadonlyArray<string> = PROTECTED(),
) {
  for (const step of [...chain, target])
    if (NodeFS.lstatSync(step, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`${step} is a symlink; refusing to write through it.`);
  const hit = protectedDirs.find((dir) => inside(target, dir));
  if (hit !== undefined) throw new Error(`${target} is inside ${hit}; refusing to write there.`);
}

/**
 * Throws unless a dev desktop may run on, and be signed in into, `userData`: not protected, not
 * reached through a symlink, not held by another desktop. `pnpm dev:desktop` checks it before
 * launching, `useSaved` before copying.
 */
export function refuseProfile(userData: string) {
  refuseDestination(partitionOf(userData), [userData, NodePath.join(userData, "Partitions")]);
  const holder = profileHolder(userData);
  if (holder !== undefined)
    throw new Error(`a desktop (PID ${holder}) holds ${userData}; quit it first.`);
}

/** Every symlink under `dir`: a copy must hold files of its own, not links back to a live profile. */
const links = (dir: string): Array<string> =>
  NodeFS.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => NodePath.join(entry.parentPath, entry.name));

const readLock = (lock: string) => {
  try {
    return NodeFS.readFileSync(lock, "utf8");
  } catch {
    return undefined;
  }
};

/** Creates `lock` holding `record` in one step (a hard link to a complete file); false when one exists. */
export function createLock(lock: string, record: string): boolean {
  const draft = `${lock}.${NodeCrypto.randomUUID()}`;
  NodeFS.writeFileSync(draft, record, { flag: "wx" });
  try {
    NodeFS.linkSync(draft, lock);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  } finally {
    NodeFS.rmSync(draft, { force: true });
  }
}

/**
 * Removes `lock` only while it still holds `expected`: moved aside first (one mover wins), then
 * deleted, or put back when it turned out to be someone else's. True when it was removed.
 */
export function claimLock(lock: string, expected: string): boolean {
  const aside = `${lock}.${NodeCrypto.randomUUID()}`;
  try {
    NodeFS.renameSync(lock, aside);
  } catch {
    return false;
  }
  if (readLock(aside) === expected) {
    NodeFS.rmSync(aside, { force: true });
    return true;
  }
  try {
    NodeFS.linkSync(aside, lock);
  } catch {
    // A third copy locked it meanwhile; theirs stands.
  }
  NodeFS.rmSync(aside, { force: true });
  return false;
}

/** A lock with no complete record is being written for this long before it counts as abandoned. */
const LOCK_GRACE_MS = 10_000;

/**
 * Holds `<to>.lock` while `run` replaces `to`, so two copies never mix. A lock whose PID is gone
 * or reused is taken over by exactly one copy; one `ps` cannot place, or a fresh one with no
 * complete record, is respected. Release removes the lock only while it is still this copy's.
 */
export function withLock<T>(to: string, run: () => T): T {
  const lock = `${to}.lock`;
  const record = JSON.stringify({
    pid: process.pid,
    at: Date.now(),
    nonce: NodeCrypto.randomUUID(),
  });
  if (!createLock(lock, record)) {
    const seen = readLock(lock);
    let held: { pid?: unknown; at?: unknown } = {};
    try {
      held = JSON.parse(seen ?? "") as typeof held;
    } catch {
      // Not a record this script writes: judged by its age below.
    }
    const complete = typeof held.pid === "number" && typeof held.at === "number";
    const age = Date.now() - (NodeFS.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0);
    const stale = complete
      ? held.pid !== process.pid &&
        ["dead", "stale"].includes(
          verdict(processInfo(held.pid as number), held.at as number, COMMANDS.copy),
        )
      : age > LOCK_GRACE_MS;
    if (seen === undefined || !stale)
      throw new Error(`another copy (PID ${String(held.pid ?? "?")}) is writing ${to}; try again.`);
    if (!claimLock(lock, seen) || !createLock(lock, record))
      throw new Error(`another copy took over ${lock} first; try again.`);
  }
  try {
    return run();
  } finally {
    claimLock(lock, record);
  }
}

/**
 * Copies a partition without its caches into a staging dir of its own beside `to`, refuses any
 * symlink in the copy, runs `accept` on it, and only then swaps it in, one copy per `to` at a
 * time. A failure at any step leaves `to` as it was.
 */
export function copyPartition(
  from: string,
  to: string,
  accept: (staging: string) => void = () => {},
) {
  const source = NodeFS.realpathSync(from);
  if (!NodeFS.existsSync(NodePath.join(source, "Cookies")))
    throw new Error(`${from} has no Cookies file; is it an x.com partition?`);
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true, mode: 0o700 });
  withLock(to, () => {
    const staging = NodeFS.mkdtempSync(`${to}.copying-`);
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
      const old = `${staging}.old`;
      const had = NodeFS.existsSync(to);
      if (had) NodeFS.renameSync(to, old);
      try {
        NodeFS.renameSync(staging, to);
      } catch (error) {
        if (had) NodeFS.renameSync(old, to);
        throw error;
      }
      NodeFS.rmSync(old, { recursive: true, force: true });
    } finally {
      NodeFS.rmSync(staging, { recursive: true, force: true });
    }
  });
}

/**
 * Copies the saved session into a dev desktop's profile, for `use`, `pnpm dev:desktop` and
 * worktree setup alike. Throws before touching anything when `refuseProfile` does, and leaves the
 * profile as it was when the saved login has expired.
 */
export function useSaved(userData: string, saved = SAVED) {
  refuseProfile(userData);
  copyPartition(saved, partitionOf(userData), (staging) => {
    if (signedIn(staging)) return;
    const expired = loginExpiry(staging)?.toISOString().slice(0, 10);
    throw new Error(
      `the saved X session ${expired === undefined ? "holds no login" : `expired on ${expired}`}; sign in in a dev desktop, then \`pnpm dev:x-session save\` again.`,
    );
  });
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

/** A login that still works: an auth_token that expires after `now`. */
export const signedIn = (partition: string, now = Date.now()) =>
  (loginExpiry(partition)?.getTime() ?? 0) > now;

const describe = (partition: string) => {
  const expiry = loginExpiry(partition);
  if (expiry === undefined) return "signed out";
  const day = expiry.toISOString().slice(0, 10);
  return expiry.getTime() > Date.now() ? `signed in until ${day}` : `signed out (expired ${day})`;
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
        if (!signedIn(staging))
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

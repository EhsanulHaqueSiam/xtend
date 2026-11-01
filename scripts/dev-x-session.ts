// One signed-in x.com session for every dev desktop, as T3's reusable dev credential is one
// pairing cookie for every dev server. `save` keeps a copy outside every repo, `use` copies it
// into a checkout's dev desktop profile, both minus Chromium's caches (1.3 GB down to a few MB).
// The copy is the user's real X login: never commit it, attach it, or share it.

//   pnpm dev:x-session status | forget (delete the saved copy) | restore <kept backup>
//   pnpm dev:x-session save [--from <checkout or user data dir> | --installed]   default: this checkout
//   pnpm dev:x-session use [--home <dir>]                                       default: the recorded home
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

/** A partition a desktop can start signed in from: a live login, no links out of it. */
const complete = (partition: string) => {
  try {
    return signedIn(partition) && links(partition).length === 0;
  } catch {
    return false;
  }
};

/** Who is copying into a staging dir, so a later run can tell an abandoned one from a live one. */
const ownerFile = (staging: string) => `${staging}.owner`;
const suffixOf = (name: string) => /-([A-Za-z0-9]{6})(?:\.|$)/.exec(name)?.[1];

/**
 * Installs a validated `staging` as `to` without a lock, via this copy's own `.old-<suffix>`.
 * A `to` that appears meanwhile stands: dropping this copy if it validates (another copy's),
 * else keeping this copy and the backup (a desktop starting). Other failures restore the backup.
 */
export function install(
  staging: string,
  to: string,
  options: { readonly rename?: typeof NodeFS.renameSync; readonly ready?: () => void } = {},
) {
  const rename = options.rename ?? NodeFS.renameSync;
  const old = `${to}.old-${suffixOf(staging)}`;
  let movedAside = false;
  let keep = false;
  try {
    try {
      rename(to, old);
      movedAside = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      options.ready?.();
      rename(staging, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const appeared = code === "ENOTEMPTY" || code === "EEXIST";
      // Another copy's validated install stands, and makes this copy's files redundant.
      if (complete(to)) {
        if (appeared) return;
        throw error;
      }
      let restored = false;
      if (movedAside && !NodeFS.existsSync(to))
        try {
          rename(old, to);
          restored = true;
        } catch {
          // Kept below.
        }
      // Whatever now sits at `to` (nothing, or a desktop's fresh profile) is no session: keep ours.
      if (appeared || (movedAside && !restored)) {
        keep = true;
        throw new Error(
          `installing ${to} failed${NodeFS.existsSync(to) ? " and it holds no usable session (a desktop probably started meanwhile)" : ""}. Nothing was removed: this copy is at ${staging}${movedAside ? `, the previous session at ${old}` : ""}.`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    if (!keep) {
      NodeFS.rmSync(staging, { recursive: true, force: true });
      NodeFS.rmSync(old, { recursive: true, force: true });
      NodeFS.rmSync(ownerFile(staging), { force: true });
    }
  }
}

/** How long a staging dir or backup with no live owner may sit before a later run removes it. */
const LEFTOVER_MS = 5 * 60_000;

/**
 * Clears what dead copies into `to` left beside it (staging dirs and backups, real cookies), once
 * older than LEFTOVER_MS with the owner gone. Only a redundant one (`to` is a usable session) or
 * an unusable one is removed; a usable one goes back to a missing `to`, or is kept and reported.
 */
export function sweep(
  to: string,
  now = Date.now(),
  info: (pid: number) => ReturnType<typeof processInfo> = processInfo,
) {
  const dir = NodePath.dirname(to);
  const base = `${NodePath.basename(to)}.`;
  let names: Array<string>;
  try {
    names = NodeFS.readdirSync(dir).filter((n) => n.startsWith(base));
  } catch {
    return { removed: [], usable: [] };
  }
  const ownerAlive = (suffix: string | undefined) => {
    if (suffix === undefined) return false;
    try {
      const record = JSON.parse(
        NodeFS.readFileSync(ownerFile(`${to}.copying-${suffix}`), "utf8"),
      ) as { pid: number; at: number };
      const state = verdict(info(record.pid), record.at, COMMANDS.copy);
      return state === "alive" || state === "unknown";
    } catch {
      return false;
    }
  };
  const removed: Array<string> = [];
  const usable: Array<string> = [];
  for (const name of names.filter((n) => !n.endsWith(".owner"))) {
    const path = NodePath.join(dir, name);
    const age = now - (NodeFS.lstatSync(path, { throwIfNoEntry: false })?.mtimeMs ?? now);
    if (age < LEFTOVER_MS || ownerAlive(suffixOf(name))) continue;
    if (!complete(to) && complete(path)) {
      if (NodeFS.existsSync(to)) usable.push(path);
      else NodeFS.renameSync(path, to);
      continue;
    }
    NodeFS.rmSync(path, { recursive: true, force: true });
    removed.push(path);
  }
  const left = NodeFS.readdirSync(dir);
  for (const name of names.filter((n) => n.endsWith(".owner"))) {
    const suffix = suffixOf(name);
    if (!left.some((n) => n !== name && suffixOf(n) === suffix) && !ownerAlive(suffix))
      NodeFS.rmSync(NodePath.join(dir, name), { force: true });
  }
  return { removed, usable };
}

/** Usable backups and staging copies beside `to`, for `status`; reads only. */
const usableBeside = (to: string) => {
  try {
    return NodeFS.readdirSync(NodePath.dirname(to))
      .map((n) => NodePath.join(NodePath.dirname(to), n))
      .filter((path) => leftoverOf(path) === NodePath.resolve(to) && complete(path));
  } catch {
    return [];
  }
};

/** The partition a leftover belongs to, from its `<to>.old-<suffix>` or `.copying-<suffix>` name. */
const leftoverOf = (path: string) =>
  /^(.*)\.(old|copying)-[A-Za-z0-9]{6}$/.exec(NodePath.resolve(path))?.[1];

/**
 * Puts a usable leftover (a backup or staging copy `sweep` kept) back as its partition, through
 * a fresh validated copy and the same checks as `use`, then removes it.
 */
export function restore(leftover: string, protectedDirs?: ReadonlyArray<string>) {
  const to = leftoverOf(leftover);
  if (to === undefined)
    throw new Error(`${leftover} is not a <partition>.old-* or .copying-* leftover.`);
  if (!complete(leftover)) throw new Error(`${leftover} holds no usable session.`);
  const parent = NodePath.dirname(to);
  // A desktop profile's partition gets the profile checks, the saved one the folder's.
  const userData =
    NodePath.basename(parent) === "Partitions" ? NodePath.dirname(parent) : undefined;
  if (userData === undefined) refuseDestination(to, [parent], protectedDirs);
  else {
    refuseDestination(to, [userData, parent], protectedDirs);
    const holder = profileHolder(userData);
    if (holder !== undefined)
      throw new Error(`a desktop (PID ${holder}) holds ${userData}; quit it first.`);
  }
  copyPartition(leftover, to, (staging) => {
    if (!complete(staging)) throw new Error(`${leftover} holds no usable session.`);
  });
  NodeFS.rmSync(leftover, { recursive: true, force: true });
  return to;
}

/**
 * Removes `to` and everything a copy into it ever left beside it, after the same checks as a
 * write: no symlink on the way, nothing inside a protected profile, or nothing is removed.
 */
export function forget(to: string, protectedDirs?: ReadonlyArray<string>) {
  const dir = NodePath.dirname(to);
  const base = NodePath.basename(to);
  refuseDestination(to, [dir], protectedDirs);
  let names: Array<string> = [];
  try {
    names = NodeFS.readdirSync(dir).filter((n) => n === base || n.startsWith(`${base}.`));
  } catch {
    return [];
  }
  const paths = names.map((n) => NodePath.join(dir, n));
  for (const path of paths) refuseDestination(path, [], protectedDirs);
  for (const path of paths) NodeFS.rmSync(path, { recursive: true, force: true });
  sweepScratch();
  return paths;
}

/**
 * Copies a partition without its caches into a staging dir of its own beside `to`, refuses any
 * symlink in the copy, runs `accept` on it, and only then installs it (`ready` runs right before
 * the final rename). A failure before the install leaves `to` as it was.
 */
export function copyPartition(
  from: string,
  to: string,
  accept: (staging: string) => void = () => {},
  ready?: () => void,
) {
  const source = NodeFS.realpathSync(from);
  if (!NodeFS.existsSync(NodePath.join(source, "Cookies")))
    throw new Error(`${from} has no Cookies file; is it an x.com partition?`);
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true, mode: 0o700 });
  for (const kept of sweep(to).usable)
    console.error(
      `[x-session] ${to} holds no usable session, but ${kept} does: \`pnpm dev:x-session restore ${kept}\` puts it back.`,
    );
  sweepScratch();
  const staging = NodeFS.mkdtempSync(`${to}.copying-`);
  NodeFS.writeFileSync(ownerFile(staging), JSON.stringify({ pid: process.pid, at: Date.now() }));
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
    NodeFS.rmSync(ownerFile(staging), { force: true });
    throw error;
  }
  install(staging, to, ready === undefined ? {} : { ready });
}

/**
 * Copies the saved session into a dev desktop's profile, for `use`, `pnpm dev:desktop` and
 * worktree setup alike. Throws before touching anything when `refuseProfile` does, and leaves the
 * profile as it was when the saved login has expired.
 */
export function useSaved(userData: string, saved = SAVED) {
  refuseProfile(userData);
  copyPartition(
    saved,
    partitionOf(userData),
    (staging) => {
      if (signedIn(staging)) return;
      const expired = loginExpiry(staging)?.toISOString().slice(0, 10);
      throw new Error(
        `the saved X session ${expired === undefined ? "holds no login" : `expired on ${expired}`}; sign in in a dev desktop, then \`pnpm dev:x-session save\` again.`,
      );
    },
    // A desktop may have started while the copy ran.
    () => {
      const holder = profileHolder(userData);
      if (holder !== undefined)
        throw new Error(`a desktop (PID ${holder}) started on ${userData}; quit it first.`);
    },
  );
  return partitionOf(userData);
}

/**
 * When X's login cookie in a partition expires, or undefined when it holds no login. Reads a
 * scratch copy: even a read-only open of a live profile's database can write its -shm file.
 */
export function loginExpiry(partition: string): Date | undefined {
  if (!NodeFS.existsSync(NodePath.join(partition, "Cookies"))) return undefined;
  // Named for its owner, so sweep and forget clear one a crash left (it holds the cookies).
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `${SCRATCH}${process.pid}-`));
  try {
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
    }
  } finally {
    NodeFS.rmSync(scratch, { recursive: true, force: true });
  }
}

const SCRATCH = "xtend-cookies-";

/**
 * Removes cookie scratch dirs in `dir` whose owner is gone, or is another program by now and
 * the dir is older than LEFTOVER_MS. A live owner's dir is in use and its own `finally` clears it.
 */
export function sweepScratch(
  dir = NodeOS.tmpdir(),
  now = Date.now(),
  info: (pid: number) => ReturnType<typeof processInfo> = processInfo,
) {
  let names: Array<string>;
  try {
    names = NodeFS.readdirSync(dir).filter((n) => n.startsWith(SCRATCH));
  } catch {
    return [];
  }
  const removed: Array<string> = [];
  for (const name of names) {
    const pid = Number(/^xtend-cookies-(\d+)-/.exec(name)?.[1]);
    const path = NodePath.join(dir, name);
    const made = NodeFS.lstatSync(path, { throwIfNoEntry: false })?.mtimeMs ?? now;
    const state = Number.isInteger(pid) ? verdict(info(pid), made, COMMANDS.copy) : "dead";
    if (state === "dead" || (state === "stale" && now - made > LEFTOVER_MS)) {
      NodeFS.rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  return removed;
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
  const { values, positionals } = NodeUtil.parseArgs({
    args: rest,
    allowPositionals: true,
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
    for (const to of [SAVED, partitionOf(here)])
      for (const kept of usableBeside(to))
        console.log(`kept    ${kept}: ${describe(kept)} (\`pnpm dev:x-session restore ${kept}\`)`);
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
  } else if (command === "restore") {
    const leftover = positionals[0] ?? fail("usage: pnpm dev:x-session restore <leftover path>");
    try {
      const to = restore(leftover);
      console.log(`[x-session] ${leftover} -> ${to} (${describe(to)})`);
    } catch (error) {
      fail((error as Error).message);
    }
  } else if (command === "forget") {
    const gone = forget(SAVED);
    console.log(
      gone.length === 0
        ? `[x-session] nothing saved in ${NodePath.dirname(SAVED)}.`
        : `[x-session] removed ${gone.join(", ")}. Dev desktops already signed in keep their copy; sign out on x.com to end the session everywhere.`,
    );
  } else {
    console.error(
      "usage: pnpm dev:x-session status | save [--from <checkout or user data dir> | --installed] | use [--home <dir>] | restore <leftover> | forget",
    );
    process.exit(2);
  }
}

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
import { alive, readDevRecord, worktrees } from "./dev-ps.ts";

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
 * keeps in user data while it runs; undefined when nothing does.
 */
export const profileHolder = (userData: string) => {
  let target: string;
  try {
    target = NodeFS.readlinkSync(NodePath.join(userData, "SingletonLock"));
  } catch {
    return undefined;
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  return Number.isInteger(pid) && alive(pid) ? pid : undefined;
};

/**
 * Copies a partition without its caches. The copy lands beside `to` and replaces it only once
 * complete, so a failed copy never costs the session already there.
 */
export function copyPartition(from: string, to: string) {
  if (!NodeFS.existsSync(NodePath.join(from, "Cookies")))
    throw new Error(`${from} has no Cookies file; is it an x.com partition?`);
  const staging = `${to}.copying`;
  NodeFS.rmSync(staging, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true, mode: 0o700 });
  NodeFS.cpSync(from, staging, {
    recursive: true,
    filter: (source) => !CACHES.has(NodePath.basename(source)),
  });
  NodeFS.rmSync(to, { recursive: true, force: true });
  NodeFS.renameSync(staging, to);
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
  const fail = (why: string) => {
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
    // Inspect the copy, never the source: an installed app's profile is read and nothing else.
    copyPartition(partitionOf(from), SAVED);
    NodeFS.chmodSync(NodePath.dirname(SAVED), 0o700);
    if (loginExpiry(SAVED) === undefined) {
      NodeFS.rmSync(SAVED, { recursive: true, force: true });
      fail(`${from} is signed out of X; nothing saved.`);
    }
    console.log(`[x-session] saved ${partitionOf(from)} -> ${SAVED} (${describe(SAVED)})`);
    console.log("[x-session] it is your real X login: never commit, attach or share it.");
  } else if (command === "use") {
    if (!NodeFS.existsSync(SAVED)) fail("nothing saved yet: pnpm dev:x-session save first.");
    const installed = NodePath.resolve(installedProfile());
    if (NodePath.resolve(here) === installed) fail(`${here} is the installed app's profile.`);
    const holder = profileHolder(here);
    if (holder !== undefined)
      fail(`this checkout's dev desktop (PID ${holder}) holds ${here}; quit it first.`);
    copyPartition(SAVED, partitionOf(here));
    console.log(`[x-session] ${SAVED} -> ${partitionOf(here)} (${describe(partitionOf(here))})`);
  } else {
    console.error(
      "usage: pnpm dev:x-session status | save [--from <checkout or user data dir> | --installed] | use [--home <dir>]",
    );
    process.exit(2);
  }
}

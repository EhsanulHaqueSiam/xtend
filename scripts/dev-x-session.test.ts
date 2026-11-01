import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "vite-plus/test";

import {
  copyPartition,
  install,
  inside,
  installedProfile,
  loginExpiry,
  profileHolder,
  refuseDestination,
  signedIn,
  useSaved,
} from "./dev-x-session.ts";

const temp = () =>
  NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-x-session-")));

/** A partition whose Cookies database holds the named cookies for x.com. */
const partition = (dir: string, cookies: ReadonlyArray<{ name: string; expires: bigint }>) => {
  NodeFS.mkdirSync(dir, { recursive: true });
  const db = new NodeSqlite.DatabaseSync(NodePath.join(dir, "Cookies"));
  db.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER)");
  for (const c of cookies)
    db.prepare("INSERT INTO cookies VALUES ('.x.com', ?, ?)").run(c.name, c.expires);
  db.close();
  return dir;
};
// 2027-01-01T00:00:00Z in Chromium's microseconds since 1601.
const JAN_2027 = (BigInt(Date.UTC(2027, 0, 1)) + 11_644_473_600_000n) * 1000n;
const signedIn_ = (dir: string) => partition(dir, [{ name: "auth_token", expires: JAN_2027 }]);

it("copies a partition without Chromium's caches, replacing the target only once complete", () => {
  const dir = temp();
  const from = signedIn_(NodePath.join(dir, "from"));
  for (const cache of ["Cache", "Code Cache", "GPUCache", "Service Worker"])
    NodeFS.mkdirSync(NodePath.join(from, cache, "deep"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(from, "Local Storage", "leveldb"), { recursive: true });
  const to = NodePath.join(dir, "to", "x-session");

  copyPartition(from, to);
  expect(NodeFS.readdirSync(to).toSorted()).toEqual(["Cookies", "Local Storage"]);
  expect(loginExpiry(to)?.toISOString()).toBe("2027-01-01T00:00:00.000Z");

  // Not a partition, or a copy that fails validation: the session already there is untouched.
  expect(() => copyPartition(NodePath.join(dir, "nothing"), to)).toThrow();
  const out = partition(NodePath.join(dir, "out"), [{ name: "guest_id", expires: JAN_2027 }]);
  expect(() =>
    copyPartition(out, to, (staging) => {
      if (loginExpiry(staging) === undefined) throw new Error("signed out");
    }),
  ).toThrow("signed out");
  expect(loginExpiry(to)).toBeDefined();
  // No staging or backup is left beside it.
  expect(NodeFS.readdirSync(NodePath.dirname(to))).toEqual(["x-session"]);
});

/** A validated copy staged beside `to` as copyPartition stages one, marked with `who`. */
const staged = (to: string, who: string) => {
  const staging = NodeFS.mkdtempSync(`${to}.copying-`);
  signedIn_(staging);
  NodeFS.writeFileSync(NodePath.join(staging, "who"), who);
  return staging;
};
const holder = (to: string) => NodeFS.readFileSync(NodePath.join(to, "who"), "utf8");

it("installs two interleaved copies without a lock: one complete session, nothing left over", () => {
  for (const at of ["before moving aside", "before taking its place"] as const) {
    const to = NodePath.join(temp(), "x-session");
    NodeFS.renameSync(staged(to, "original"), to);
    const a = staged(to, "A");
    const b = staged(to, "B");
    let calls = 0;
    // B installs completely at one of A's two steps.
    install(a, to, (from, dest) => {
      calls++;
      if (
        (at === "before moving aside" && calls === 1) ||
        (at === "before taking its place" && calls === 2)
      )
        install(b, to);
      NodeFS.renameSync(from, dest);
    });
    // Before A moved aside, A replaces B; after, B's session stands and A's is dropped.
    expect(holder(to), at).toBe(at === "before moving aside" ? "A" : "B");
    expect(loginExpiry(to), at).toBeDefined();
    expect(NodeFS.readdirSync(NodePath.dirname(to)), at).toEqual(["x-session"]);
  }
});

it("puts the original back when installing fails for any other reason", () => {
  const to = NodePath.join(temp(), "x-session");
  NodeFS.renameSync(staged(to, "original"), to);
  const copy = staged(to, "new");
  const crossDevice = Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  expect(() =>
    install(copy, to, (from, dest) => {
      if (from === copy) throw crossDevice;
      NodeFS.renameSync(from, dest);
    }),
  ).toThrow("EXDEV");
  expect(holder(to)).toBe("original");
  expect(NodeFS.readdirSync(NodePath.dirname(to))).toEqual(["x-session"]);
});

it("will not install a saved session whose login expired", () => {
  const dir = temp();
  const saved = partition(NodePath.join(dir, "saved"), [{ name: "auth_token", expires: 1n }]);
  const userData = NodePath.join(dir, "electron");
  expect(() => useSaved(userData, saved)).toThrow(/expired on 1601-01-01.*save/);
  expect(NodeFS.existsSync(NodePath.join(userData, "Partitions", "x-session"))).toBe(false);
});

it("counts only a login that has not expired", () => {
  const dir = temp();
  const partition = signedIn_(NodePath.join(dir, "p"));
  expect(signedIn(partition, Date.UTC(2026, 10, 1))).toBe(true);
  expect(signedIn(partition, Date.UTC(2027, 0, 2))).toBe(false);
  expect(signedIn(NodePath.join(dir, "missing"), 0)).toBe(false);
});

it("refuses a source holding symlinks, so a copy never writes through to a live profile", () => {
  const dir = temp();
  const live = signedIn_(NodePath.join(dir, "live"));
  const from = signedIn_(NodePath.join(dir, "from"));
  NodeFS.symlinkSync(NodePath.join(live, "Cookies"), NodePath.join(from, "Cookies-journal"));
  NodeFS.mkdirSync(NodePath.join(from, "Local Storage"));
  NodeFS.symlinkSync(live, NodePath.join(from, "Local Storage", "leveldb"));
  const to = NodePath.join(dir, "to");
  expect(() => copyPartition(from, to)).toThrow(/symlinks.*Cookies-journal/);
  expect(NodeFS.existsSync(to)).toBe(false);
});

it("refuses a destination reached through a symlink or inside a protected profile", () => {
  const dir = temp();
  const installed = NodePath.join(dir, "Xtend");
  NodeFS.mkdirSync(NodePath.join(installed, "Partitions"), { recursive: true });
  const userData = NodePath.join(dir, "checkout", "electron");
  const chain = (u: string) => [u, NodePath.join(u, "Partitions")];
  const target = (u: string) => NodePath.join(u, "Partitions", "x-session");

  expect(() => refuseDestination(target(userData), chain(userData), [installed])).not.toThrow();
  // XTEND_USER_DATA pointing into the installed profile, by any spelling.
  const spelled = NodePath.join(dir, "checkout", "..", "Xtend");
  expect(() => refuseDestination(target(spelled), chain(spelled), [installed])).toThrow("inside");
  // A symlinked Partitions dir would redirect the replace into the installed profile.
  NodeFS.mkdirSync(userData, { recursive: true });
  NodeFS.symlinkSync(NodePath.join(installed, "Partitions"), NodePath.join(userData, "Partitions"));
  expect(() => refuseDestination(target(userData), chain(userData), [installed])).toThrow(
    "symlink",
  );
  // A case alias of the protected dir, existing or not below it, is the same dir where the
  // filesystem ignores case (macOS by default) and a different one where it does not.
  const alias = installed.replace("Xtend", "XTEND");
  const caseless = NodeFS.existsSync(alias);
  expect(inside(NodePath.join(alias, "Partitions", "x-session"), installed)).toBe(caseless);
  expect(inside(NodePath.join(alias, "new", "deep"), installed)).toBe(caseless);
  expect(inside(NodePath.join(dir, "checkout"), installed)).toBe(false);
  // A symlink above the chain still resolves into the protected dir.
  const above = NodePath.join(dir, "above");
  NodeFS.symlinkSync(installed, above);
  expect(() => refuseDestination(target(above), [], [installed])).toThrow("inside");
});

it("finds the desktop holding a profile from its SingletonLock, not a stranger with the PID", () => {
  const dir = temp();
  NodeFS.symlinkSync("host.local-4242", NodePath.join(dir, "SingletonLock"));
  const locked = NodeFS.lstatSync(NodePath.join(dir, "SingletonLock")).mtimeMs;
  const electron = "/x/Electron.app/Contents/MacOS/Electron /x/apps/desktop";
  expect(profileHolder(dir, () => ({ start: locked - 1_000, command: electron }))).toBe(4242);
  // `ps` could not say: held, so nothing writes over a profile that may be live.
  expect(profileHolder(dir, () => "unreadable")).toBe(4242);
  // A crash left the lock: the PID is gone, or reused by another program or a later process.
  expect(profileHolder(dir, () => "gone")).toBe(undefined);
  expect(profileHolder(dir, () => ({ start: locked - 1_000, command: "/usr/bin/vim" }))).toBe(
    undefined,
  );
  expect(profileHolder(dir, () => ({ start: locked + 60_000, command: electron }))).toBe(undefined);
  expect(profileHolder(temp())).toBe(undefined);
});

it("finds the installed app's profile where Electron puts it", () => {
  expect(installedProfile("darwin", "/Users/me")).toBe(
    "/Users/me/Library/Application Support/Xtend",
  );
  expect(installedProfile("linux", "/home/me")).toMatch(/\/Xtend$/);
});

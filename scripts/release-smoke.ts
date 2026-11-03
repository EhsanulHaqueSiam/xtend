// Checks every packaged app in apps/desktop/release: main and preloads in app.asar, the web app
// and service beside it, then that the service answers /api/health when run like the app runs it
// (its own Electron as Node, the packaged files copied out so no node_modules can stand in).
// Apps for another platform get the contents check only.

//   pnpm dist:desktop:dmg:arm64 && pnpm release:smoke
//   pnpm dist:desktop:appimage && pnpm release:smoke
//   pnpm release:smoke --boot              fail unless this machine's own build started
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const release = NodePath.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const IN_ASAR = [
  "package.json",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "dist-electron/overlayPreload.cjs",
];
const IN_RESOURCES = ["apps/web/dist/index.html", "apps/server/dist/bin.mjs"];
const BOOT_TIMEOUT_MS = 20_000;

interface Packaged {
  readonly name: string;
  readonly platform: NodeJS.Platform;
  readonly arch: "arm64" | "x64";
  readonly resources: string;
  /** The Electron binary that runs the service as Node. */
  readonly runtime: string;
}

interface AsarEntry {
  readonly files?: Readonly<Record<string, AsarEntry>>;
}

// app.asar opens with Chromium pickles: the JSON header's length is at byte 12, the header at 16.
const asarHeader = (file: string): AsarEntry => {
  const bytes = NodeFS.readFileSync(file);
  return JSON.parse(bytes.toString("utf8", 16, 16 + bytes.readUInt32LE(12))) as AsarEntry;
};

// electron-builder's unpacked dirs: mac, linux-unpacked, win-unpacked, and -arm64 before the
// suffix for arm64. x64 goes unnamed.
const found = (NodeFS.existsSync(release) ? NodeFS.readdirSync(release) : []).flatMap(
  (name): ReadonlyArray<Packaged> => {
    const match = /^(mac|linux|win)(-arm64)?(-unpacked)?$/.exec(name);
    if (match === null) return [];
    const [, os, arm64] = match;
    const dir = NodePath.join(release, name);
    const arch = arm64 === undefined ? "x64" : "arm64";
    if (os === "mac") {
      const app = NodePath.join(dir, "Xtend.app");
      if (!NodeFS.existsSync(app)) return [];
      return [
        {
          name: `${name}/Xtend.app`,
          platform: "darwin",
          arch,
          resources: NodePath.join(app, "Contents", "Resources"),
          runtime: NodePath.join(app, "Contents", "MacOS", "Xtend"),
        },
      ];
    }
    return [
      {
        name,
        platform: os === "win" ? "win32" : "linux",
        arch,
        resources: NodePath.join(dir, "resources"),
        runtime: NodePath.join(dir, os === "win" ? "Xtend.exe" : "xtend"),
      },
    ];
  },
);
if (found.length === 0) {
  console.error(`release-smoke: no packaged app under ${release}. Build one first.`);
  process.exit(1);
}

const missingFiles = (app: Packaged) => {
  const header = asarHeader(NodePath.join(app.resources, "app.asar"));
  const inAsar = (path: string) => {
    let entry: AsarEntry | undefined = header;
    for (const name of path.split("/")) entry = entry?.files?.[name];
    return entry !== undefined;
  };
  return [
    ...IN_ASAR.filter((path) => !inAsar(path)).map((path) => `app.asar/${path}`),
    ...IN_RESOURCES.filter((path) => !NodeFS.existsSync(NodePath.join(app.resources, path))),
  ];
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });

const healthy = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
};

/** Starts the packaged service on a throwaway dir and port; null when it answered, else its output. */
async function bootService(app: Packaged): Promise<string | null> {
  const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-release-smoke-"));
  NodeFS.cpSync(NodePath.join(app.resources, "apps"), NodePath.join(scratch, "apps"), {
    recursive: true,
  });
  const port = await freePort();
  let output = "";
  const child = NodeChildProcess.spawn(
    app.runtime,
    [
      NodePath.join(scratch, "apps", "server", "dist", "bin.mjs"),
      "--base-dir",
      NodePath.join(scratch, "state"),
      "--port",
      String(port),
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const started = Date.now();
  const wait = async (): Promise<boolean> => {
    if (child.exitCode !== null || Date.now() - started > BOOT_TIMEOUT_MS) return false;
    if (await healthy(`http://127.0.0.1:${port}/api/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return wait();
  };
  const ok = await wait();
  // Windows holds the database open until the process is gone, and rm fails with EBUSY.
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  if (child.exitCode === null) await exited;
  NodeFS.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
  return ok ? null : output.trim() || `no answer within ${BOOT_TIMEOUT_MS / 1000}s`;
}

const failures: Array<string> = [];
let booted = 0;
for (const app of found) {
  const missing = missingFiles(app);
  for (const path of missing) failures.push(`${app.name}: missing ${path}`);
  if (missing.length > 0) continue;
  // Only this machine's platform and arch can run the binary.
  if (app.platform !== process.platform || app.arch !== process.arch) {
    console.log(`release-smoke: ${app.name}: contents ok (built for another machine)`);
    continue;
  }
  // One at a time, so a failure's output is its own.
  const error = await bootService(app);
  if (error === null) {
    booted += 1;
    console.log(`release-smoke: ${app.name}: contents ok, service started`);
  } else failures.push(`${app.name}: service did not start\n${error}`);
}
// CI builds on the machine it ships for, so a contents-only pass there means a wrong runner.
if (process.argv.includes("--boot") && booted === 0)
  failures.push(`nothing built for ${process.platform}-${process.arch} to start`);
if (failures.length > 0) {
  console.error(`release-smoke: failed\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

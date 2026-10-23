// Runs this checkout's dev processes on a port pair of its own, so several checkouts and T3
// worktrees run at once. The search starts at the defaults (service 4820, web 5820) in the main
// checkout, at an offset hashed from the path in a linked worktree, or at XTEND_PORT_OFFSET; the
// first pair whose ports are free wins. `dev` records its pair in .xtend/dev-ports.json, and
// dev:desktop connects to it.
//   pnpm dev           contracts, service and web
//   pnpm dev:server    the service
//   pnpm dev:web       the web app
//   pnpm dev:desktop   the Electron main in watch mode, launched against the recorded pair
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

const SERVICE_PORT = 4820;
const WEB_PORT = 5820;
// Hashed offsets stay inside the gap between the two bases, so a service port never lands on a web port.
const HASH_OFFSETS = WEB_PORT - SERVICE_PORT - 1;
// Browsers and Node's fetch refuse these (https://fetch.spec.whatwg.org/#port-blocking); the
// list holds only the ones above 4820.
const BLOCKED_PORTS = new Set([
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

const MODES = {
  dev: {
    args: [
      "--filter",
      "@xtend/contracts",
      "--filter",
      "@xtend/web",
      "--filter",
      "xtend",
      "--parallel",
    ],
    binds: { service: true, web: true },
  },
  "dev:server": { args: ["--filter", "xtend"], binds: { service: true, web: false } },
  "dev:web": { args: ["--filter", "@xtend/web"], binds: { service: false, web: true } },
  "dev:desktop": { args: ["--filter", "@xtend/desktop"], binds: { service: false, web: false } },
} as const;
const modes = new Map(Object.entries(MODES));

export interface Ports {
  readonly service: number;
  readonly web: number;
}

export const portsAt = (offset: number): Ports => ({
  service: SERVICE_PORT + offset,
  web: WEB_PORT + offset,
});

/** Where a checkout's search starts. `pinned` is XTEND_PORT_OFFSET. */
export function startOffset(checkout: {
  readonly path: string;
  readonly linkedWorktree: boolean;
  readonly pinned: string | undefined;
}): number {
  if (checkout.pinned !== undefined) {
    if (!/^\d+$/.test(checkout.pinned))
      throw new Error(`XTEND_PORT_OFFSET must be a whole number, got "${checkout.pinned}".`);
    return Number(checkout.pinned);
  }
  if (!checkout.linkedWorktree) return 0;
  const hash = NodeCrypto.createHash("sha256").update(checkout.path).digest().readUInt32BE(0);
  return (hash % HASH_OFFSETS) + 1;
}

/**
 * The first pair from `offset` with no blocked port whose ports this mode binds are free. Both
 * ports move together so the web proxy and the desktop always find the service beside them.
 */
export async function choosePorts(
  offset: number,
  binds: { readonly service: boolean; readonly web: boolean },
  isFree: (port: number) => Promise<boolean>,
): Promise<Ports> {
  const ports = portsAt(offset);
  if (ports.web > 65_535) throw new Error("No free dev port pair below 65535.");
  const usable =
    !BLOCKED_PORTS.has(ports.service) &&
    !BLOCKED_PORTS.has(ports.web) &&
    (!binds.service || (await isFree(ports.service))) &&
    (!binds.web || (await isFree(ports.web)));
  return usable ? ports : choosePorts(offset + 1, binds, isFree);
}

const canListen = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = NodeNet.createServer();
    // Only a holder counts as taken: a host without IPv6 fails ::1 with another code.
    server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code !== "EADDRINUSE"));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });

// The service binds 127.0.0.1 and Vite binds localhost, which is ::1 on macOS.
const isFree = async (port: number) =>
  (await canListen(port, "127.0.0.1")) && (await canListen(port, "::1"));

const readRecord = (file: string): Ports | undefined => {
  try {
    const { service, web } = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Partial<Ports>;
    return typeof service === "number" && typeof web === "number" ? { service, web } : undefined;
  } catch {
    return undefined;
  }
};

if (import.meta.main) {
  const name = process.argv[2] ?? "";
  const mode = modes.get(name);
  if (mode === undefined) {
    console.error(`usage: node scripts/dev-runner.ts ${[...modes.keys()].join("|")}`);
    process.exit(1);
  }
  const root = NodePath.resolve(import.meta.dirname, "..");
  const stateDir = NodePath.join(root, ".xtend");
  const recordFile = NodePath.join(stateDir, "dev-ports.json");
  const start = startOffset({
    path: root,
    // A linked worktree has a .git file pointing at the main checkout's .git directory.
    linkedWorktree:
      NodeFS.statSync(NodePath.join(root, ".git"), { throwIfNoEntry: false })?.isFile() === true,
    pinned: process.env.XTEND_PORT_OFFSET,
  });
  const desktop = name === "dev:desktop";
  const recorded = desktop ? readRecord(recordFile) : undefined;
  const ports = desktop
    ? (recorded ?? portsAt(start))
    : await choosePorts(start, mode.binds, isFree);
  const serviceUrl = `http://127.0.0.1:${ports.service}`;
  const webUrl = `http://localhost:${ports.web}`;

  // Explicit values beat anything inherited from a parent dev process.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XTEND_PORT: String(ports.service),
    XTEND_WEB_PORT: String(ports.web),
  };
  if (desktop) {
    Object.assign(env, {
      XTEND_SERVICE_URL: serviceUrl,
      XTEND_DEV_URL: webUrl,
      // The desktop reads the service token from here and never touches ~/.xtend.
      XTEND_HOME: stateDir,
    });
    // Electron allows one instance per user data dir, so only the default pair keeps the
    // default one (and its x.com login); any other pair gets this checkout's own.
    if (ports.service !== SERVICE_PORT) env.XTEND_USER_DATA ??= NodePath.join(stateDir, "electron");
  } else if (name === "dev") {
    NodeFS.mkdirSync(stateDir, { recursive: true });
    NodeFS.writeFileSync(recordFile, JSON.stringify(ports));
  }

  const source = desktop
    ? recorded === undefined
      ? "no pair recorded, using this checkout's first"
      : `recorded in ${recordFile}`
    : `offset ${ports.service - SERVICE_PORT}, first free from ${start}`;
  console.log(`[dev-runner] ${name}: service ${serviceUrl}  web ${webUrl}  state ${stateDir}`);
  console.log(`[dev-runner] ports: ${source}`);

  // Its own process group, so stopping this runner stops every process it started and nothing
  // else. stdin stays closed: the terminal stops a background group that reads it.
  const child = NodeChildProcess.spawn(
    NodePath.join(root, "node_modules", ".bin", "vp"),
    ["run", ...mode.args, "dev"],
    { cwd: root, env, stdio: ["ignore", "inherit", "inherit"], detached: true },
  );
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // The group already exited.
    }
  };
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      stopping = true;
      signalGroup(signal);
    });
  }
  child.on("exit", (code) => {
    // Whatever vp left behind goes with it.
    signalGroup("SIGTERM");
    if (name === "dev" && readRecord(recordFile)?.service === ports.service)
      NodeFS.rmSync(recordFile);
    process.exit(stopping ? 0 : (code ?? 1));
  });
}

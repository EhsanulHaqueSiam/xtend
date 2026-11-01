// Runs this checkout's dev processes on a free port pair of its own, so several checkouts run at
// once: defaults (service 4820, web 5820) in the main checkout, an offset hashed from the path in a
// worktree, or XTEND_PORT_OFFSET. `dev` records the pair and home in .xtend/dev-ports.json.
// treg, the pool and AI assist go to a local fake; a fresh home is seeded first (seed-dev.ts).

//   pnpm dev | dev:server | dev:web   service and web, or one of them
//   pnpm dev:desktop                  the Electron main on <home>/electron, against the recorded pair
//   flags: --home <dir>  --seed demo|real|none (first start)  --live (real treg and pool: money)
//          --fixture <name> [--fresh]  a named UI state from scripts/fixtures, in its own home
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { startFakeTreg } from "../apps/e2e/src/fakeTreg.ts";
import { refuseLiveHome } from "../apps/server/scripts/devData.ts";
import { devUserData, loginExpiry, partitionOf, SAVED, useSaved } from "./dev-x-session.ts";

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

/** Where the dev fake (treg, pool, model) listens: clear of every checkout's service and web ports. */
export const fakePortOf = (ports: Ports) => ports.service + 3000;

const SEEDS = ["demo", "real", "none"] as const;
type Seed = (typeof SEEDS)[number];

/**
 * The runner's flags after the mode. `--no-seed` is `--seed none`; XTEND_DEV_SEED sets the default.
 * `home` stays undefined for the checkout's own .xtend.
 */
export function parseFlags(args: ReadonlyArray<string>, envSeed: string | undefined) {
  const { values } = NodeUtil.parseArgs({
    args: [...args],
    options: {
      home: { type: "string" },
      seed: { type: "string" },
      "no-seed": { type: "boolean", default: false },
      live: { type: "boolean", default: false },
      fixture: { type: "string" },
      fresh: { type: "boolean", default: false },
    },
  });
  const named = values["no-seed"] ? "none" : (values.seed ?? envSeed ?? "demo");
  const seed = SEEDS.find((s) => s === named);
  if (seed === undefined) throw new Error(`--seed takes ${SEEDS.join("|")}, got "${named}".`);
  if (values.home !== undefined) refuseLiveHome(values.home);
  if (values.fixture !== undefined && !FIXTURE_NAME.test(values.fixture))
    throw new Error(`--fixture takes a name from scripts/fixtures, got "${values.fixture}".`);
  return {
    home: values.home,
    seed: seed satisfies Seed,
    live: values.live,
    fixture: values.fixture,
    fresh: values.fresh,
  };
}

const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A named UI state (scripts/fixtures/<name>.json): the seed it starts from, SQL that bends it into
 * the state, and the route that shows it. Direct writes are for visual states only; behaviour is
 * proven through the service, not by rows.
 */
export interface Fixture {
  readonly description: string;
  readonly seed: "demo" | "none";
  /** The seed's fixed clock instead of now, for captures that must match across runs. */
  readonly frozen?: boolean;
  readonly sql?: ReadonlyArray<string>;
  readonly open: string;
}

export function readFixture(root: string, name: string): Fixture {
  const file = NodePath.join(root, "scripts", "fixtures", `${name}.json`);
  if (!NodeFS.existsSync(file)) {
    const known = NodeFS.readdirSync(NodePath.join(root, "scripts", "fixtures"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
    throw new Error(`No fixture "${name}". Known: ${known.join(", ")}.`);
  }
  const raw: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  const f = raw as Partial<Fixture>;
  if (
    typeof f.description !== "string" ||
    (f.seed !== "demo" && f.seed !== "none") ||
    typeof f.open !== "string" ||
    !f.open.startsWith("/") ||
    (f.sql !== undefined && !(Array.isArray(f.sql) && f.sql.every((q) => typeof q === "string")))
  )
    throw new Error(`${file}: want {description, seed: demo|none, open: "/route", sql?: [..]}.`);
  return f as Fixture;
}

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

const readRecord = (file: string): (Ports & { readonly home?: string }) | undefined => {
  try {
    const { service, web, home } = JSON.parse(NodeFS.readFileSync(file, "utf8")) as Partial<
      Ports & { home: string }
    >;
    return typeof service === "number" && typeof web === "number"
      ? { service, web, ...(typeof home === "string" ? { home } : {}) }
      : undefined;
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
  const flags = parseFlags(process.argv.slice(3), process.env.XTEND_DEV_SEED);
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
  const fixture = flags.fixture === undefined ? undefined : readFixture(root, flags.fixture);
  // A fixture gets a home of its own, so the checkout's .xtend keeps its data.
  const fixtureHome =
    flags.fixture === undefined ? undefined : NodePath.join(root, ".xtend-fixtures", flags.fixture);
  if (fixtureHome !== undefined && flags.fresh)
    NodeFS.rmSync(fixtureHome, { recursive: true, force: true });
  // The desktop follows the home `dev` recorded unless told otherwise.
  const home = NodePath.resolve(flags.home ?? fixtureHome ?? recorded?.home ?? stateDir);

  // Explicit values beat anything inherited from a parent dev process.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XTEND_PORT: String(ports.service),
    XTEND_WEB_PORT: String(ports.web),
    // The service's base dir, and where the desktop reads the service token: never ~/.xtend.
    XTEND_HOME: home,
  };
  if (desktop) {
    Object.assign(env, { XTEND_SERVICE_URL: serviceUrl, XTEND_DEV_URL: webUrl });
    // Always a profile of this checkout's own: the default one is the installed app's, and its
    // x-session partition is the user's live X login.
    env.XTEND_USER_DATA ??= devUserData(home);
    const partition = partitionOf(env.XTEND_USER_DATA);
    // Signed out and nothing holds the profile yet: start from the saved session (dev-x-session.ts).
    if (loginExpiry(partition) === undefined) {
      if (NodeFS.existsSync(SAVED))
        try {
          useSaved(env.XTEND_USER_DATA);
          console.log(`[dev-runner] signed in from the saved X session (${SAVED})`);
        } catch (error) {
          console.log(
            `[dev-runner] not signed in from the saved X session: ${(error as Error).message}`,
          );
        }
      else
        console.log(
          "[dev-runner] this dev desktop is signed out of X: sign in in its window, then `pnpm dev:x-session save` so every checkout starts signed in.",
        );
    }
  } else if (name === "dev") {
    NodeFS.mkdirSync(stateDir, { recursive: true });
    const record = { ...ports, home, pid: process.pid, startedAt: new Date().toISOString() };
    NodeFS.writeFileSync(recordFile, JSON.stringify(record));
  }

  let closeFake = () => Promise.resolve<unknown>(undefined);
  if (mode.binds.service) {
    const fake = await startFakeTreg(fakePortOf(ports));
    closeFake = fake.close;
    if (!flags.live)
      Object.assign(env, {
        XTEND_TREG_URL: fake.url,
        XTEND_POOL_URL: fake.url,
        XTEND_TREG_TOKEN: "dev",
      });
    console.log(
      flags.live
        ? `[dev-runner] lanes: treg and pool LIVE (spends your balance); model fake at ${fake.url}`
        : `[dev-runner] lanes: treg, pool and model fake at ${fake.url} (--live for real treg and pool)`,
    );
    const db = NodePath.join(home, "xtend.sqlite");
    const seed = fixture?.seed ?? flags.seed;
    const run = (args: ReadonlyArray<string>) =>
      NodeChildProcess.spawnSync(process.execPath, [...args], {
        cwd: NodePath.join(root, "apps", "server"),
        stdio: "inherit",
      }).status === 0;
    const fail = async (why: string) => {
      await closeFake();
      console.error(`[dev-runner] ${why}; ${home} is left as it is.`);
      process.exit(1);
    };
    if (seed !== "none" && !NodeFS.existsSync(db)) {
      const script = seed === "demo" ? "seed-dev.ts" : "copy-dev-db.ts";
      console.log(`[dev-runner] first start: ${seed} data into ${home}`);
      const args = [NodePath.join("scripts", script), "--base-dir", home, "--assist-url", fake.url];
      if (!run(fixture?.frozen === true ? [...args, "--frozen"] : args))
        await fail("seeding failed");
      // A fixture's state applies once, onto the seed it was written against.
      for (const sql of fixture?.sql ?? [])
        if (
          !run([
            NodePath.join("scripts", "xtend-sqlite-state.ts"),
            "exec",
            "--base-dir",
            home,
            "--sql",
            sql,
          ])
        )
          await fail(`fixture SQL failed: ${sql}`);
    }
  }

  const source = desktop
    ? recorded === undefined
      ? "no pair recorded, using this checkout's first"
      : `recorded in ${recordFile}`
    : `offset ${ports.service - SERVICE_PORT}, first free from ${start}`;
  console.log(`[dev-runner] ${name}: service ${serviceUrl}  web ${webUrl}  state ${home}`);
  if (fixture !== undefined)
    console.log(
      `[dev-runner] fixture ${flags.fixture}: ${fixture.description}\n  open ${webUrl}${fixture.open}`,
    );
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
  child.on("exit", async (code) => {
    // Whatever vp left behind goes with it.
    signalGroup("SIGTERM");
    await closeFake();
    if (name === "dev" && readRecord(recordFile)?.service === ports.service)
      NodeFS.rmSync(recordFile);
    process.exit(stopping ? 0 : (code ?? 1));
  });
}

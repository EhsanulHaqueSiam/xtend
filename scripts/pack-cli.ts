// Packs the xtend CLI as an npm tarball, dist-cli/xtend-cli-<version>.tgz: the bundled service
// with the web app beside it, in the layout the desktop ships (the service finds the web app at
// ../../web/dist from its own file). AI assist runs the user's own claude or codex CLI, so the
// tarball has no dependencies.
//   pnpm build && pnpm cli:pack            the tarball
//   pnpm cli:pack --check                  and install it into a throwaway prefix and start it
//   npm install -g dist-cli/xtend-cli-*.tgz
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const out = NodePath.join(root, "dist-cli");
const stage = NodePath.join(out, "package");
const server = JSON.parse(
  NodeFS.readFileSync(NodePath.join(root, "apps", "server", "package.json"), "utf8"),
) as { version: string };
const BOOT_TIMEOUT_MS = 20_000;

for (const built of ["apps/server/dist/bin.mjs", "apps/web/dist/index.html"]) {
  if (!NodeFS.existsSync(NodePath.join(root, built))) {
    console.error(`pack-cli: ${built} is missing. Run pnpm build first.`);
    process.exit(1);
  }
}

NodeFS.rmSync(out, { recursive: true, force: true });
NodeFS.mkdirSync(NodePath.join(stage, "apps", "server", "dist"), { recursive: true });
// npm links `xtend` straight to this file, so it needs the interpreter line the bundle lacks.
const bundle = NodeFS.readFileSync(
  NodePath.join(root, "apps", "server", "dist", "bin.mjs"),
  "utf8",
);
NodeFS.writeFileSync(
  NodePath.join(stage, "apps", "server", "dist", "bin.mjs"),
  bundle.startsWith("#!") ? bundle : `#!/usr/bin/env node\n${bundle}`,
);
NodeFS.cpSync(
  NodePath.join(root, "apps", "web", "dist"),
  NodePath.join(stage, "apps", "web", "dist"),
  {
    recursive: true,
  },
);
NodeFS.writeFileSync(
  NodePath.join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "xtend-cli",
      version: server.version,
      description: "The Xtend service and CLI: run it, or drive a running one.",
      type: "module",
      bin: { xtend: "apps/server/dist/bin.mjs" },
      // node:sqlite with backup().
      engines: { node: ">=24" },
      private: true,
    },
    null,
    2,
  )}\n`,
);

const run = (command: string, args: ReadonlyArray<string>, cwd: string) => {
  const result = NodeChildProcess.spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.error?.message ?? `${result.stdout}${result.stderr}`;
    console.error(`pack-cli: ${command} ${args.join(" ")} failed\n${detail}`);
    process.exit(1);
  }
  return result.stdout.trim();
};
run("npm", ["pack", "--pack-destination", out], stage);
const tarball = NodePath.join(out, `xtend-cli-${server.version}.tgz`);
console.log(`pack-cli: ${NodePath.relative(root, tarball)}`);

if (process.argv.includes("--check")) {
  // A real global install into a throwaway prefix, then the installed command: version, and the
  // service answering on a throwaway port and base dir.
  const prefix = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-cli-check-"));
  run("npm", ["install", "-g", "--prefix", prefix, tarball], prefix);
  const bin = NodePath.join(prefix, "bin", "xtend");
  const version = run(bin, ["--version"], prefix);
  if (!version.includes(server.version)) {
    console.error(`pack-cli: installed xtend printed "${version}", expected ${server.version}`);
    process.exit(1);
  }
  const port = await new Promise<number>((resolve, reject) => {
    const probe = NodeNet.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
  let output = "";
  const child = NodeChildProcess.spawn(
    bin,
    ["--base-dir", NodePath.join(prefix, "state"), "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const started = Date.now();
  const answered = async (): Promise<boolean> => {
    if (child.exitCode !== null || Date.now() - started > BOOT_TIMEOUT_MS) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(1_000),
      });
      // The page proves the web app came along, not just the service.
      if (response.ok && (await response.text()).includes('id="root"')) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    return answered();
  };
  const ok = await answered();
  child.kill("SIGTERM");
  NodeFS.rmSync(prefix, { recursive: true, force: true });
  if (!ok) {
    console.error(`pack-cli: the installed service did not serve the app\n${output}`);
    process.exit(1);
  }
  console.log(`pack-cli: installed ${version}, service served the app`);
}

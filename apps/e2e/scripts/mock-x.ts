// Runs mock X on its own, for UI work on Xtend's X screens without an X account.
//   pnpm mock-x                 mock X on a free port, until Ctrl-C
//   pnpm mock-x --desktop       mock X, and the dev desktop on it (pnpm dev must be running)
// See docs/operations/development.md#mock-x.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { startMockX } from "../src/mockX/server.ts";

const portArg = process.argv.indexOf("--port");
const mock = await startMockX({ port: portArg === -1 ? 0 : Number(process.argv[portArg + 1]) });
process.stdout.write(
  `mock X: ${mock.url} (the desktop serves https://x.com from it with XTEND_MOCK_X=${mock.url})\n`,
);

let desktop: NodeChildProcess.ChildProcess | undefined;
if (process.argv.includes("--desktop")) {
  // The desktop is started here, not through `pnpm dev:desktop`, which signs its profile in with
  // the saved real X session. On mock X, main takes a fresh profile and never hands over to a
  // running Xtend; it needs only the pair `pnpm dev` recorded.
  const root = NodePath.resolve(import.meta.dirname, "../../..");
  const desktopDir = NodePath.join(root, "apps/desktop");
  const record = NodePath.join(root, ".xtend/dev-ports.json");
  if (!NodeFS.existsSync(record)) {
    process.stderr.write("mock-x: no running `pnpm dev` recorded here; start it first.\n");
    await mock.close();
    process.exit(1);
  }
  const ports = JSON.parse(NodeFS.readFileSync(record, "utf8")) as {
    readonly service: number;
    readonly web: number;
    readonly home: string;
  };
  // XTEND_DESKTOP_DEV would make the pack launch a desktop of its own.
  const { XTEND_DESKTOP_DEV: _launch, XTEND_USER_DATA: _profile, ...env } = process.env;
  NodeChildProcess.execFileSync(NodePath.join(desktopDir, "node_modules/.bin/vp"), ["pack"], {
    cwd: desktopDir,
    stdio: "inherit",
    env,
  });
  // Electron's temp dir, the profile main makes in it included: removed once Electron has exited.
  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-mock-x-run-"));
  desktop = NodeChildProcess.spawn(
    NodeModule.createRequire(NodePath.join(desktopDir, "package.json"))("electron") as string,
    [desktopDir],
    {
      stdio: "inherit",
      env: {
        ...env,
        XTEND_HOME: ports.home,
        XTEND_SERVICE_URL: `http://127.0.0.1:${ports.service}`,
        XTEND_DEV_URL: `http://localhost:${ports.web}`,
        XTEND_MOCK_X: mock.url,
        TMPDIR: tmp,
      },
    },
  );
  desktop.on("exit", (code) => {
    NodeFS.rmSync(tmp, { recursive: true, force: true });
    void mock.close().then(() => process.exit(code ?? 0));
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    // With a desktop, its exit closes the mock and removes its temp dir.
    if (desktop !== undefined) desktop.kill(signal);
    else void mock.close().then(() => process.exit(0));
  });

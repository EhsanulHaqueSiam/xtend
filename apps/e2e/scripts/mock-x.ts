// Runs mock X on its own, for UI work on Xtend's X screens without an X account.
//   pnpm mock-x                 mock X on a free port, until Ctrl-C
//   pnpm mock-x --desktop       mock X, and the dev desktop on it (pnpm dev must be running)
// See docs/operations/development.md#mock-x.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { startMockX } from "../src/mockX/server.ts";

const portArg = process.argv.indexOf("--port");
const mock = await startMockX({ port: portArg === -1 ? 0 : Number(process.argv[portArg + 1]) });
process.stdout.write(
  `mock X: ${mock.url} (the desktop serves https://x.com from it with XTEND_MOCK_X=${mock.url})\n`,
);

let desktop: NodeChildProcess.ChildProcess | undefined;
if (process.argv.includes("--desktop")) {
  desktop = NodeChildProcess.spawn("pnpm", ["dev:desktop"], {
    cwd: NodePath.resolve(import.meta.dirname, "../../.."),
    stdio: "inherit",
    // With XTEND_MOCK_X, main takes a fresh profile of its own and never hands over to a running Xtend.
    env: { ...process.env, XTEND_MOCK_X: mock.url },
  });
  desktop.on("exit", (code) => void mock.close().then(() => process.exit(code ?? 0)));
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    desktop?.kill(signal);
    void mock.close().then(() => process.exit(0));
  });

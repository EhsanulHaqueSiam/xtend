import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { lockAppDir } from "./lock.ts";

it("lets one process build a checkout at a time, and frees the lock when that process dies", async () => {
  const appDir = `/tmp/xtend-lock-test-${process.pid}`;
  // Another run, in its own process, takes the lock and reports it.
  const other = NodeChildProcess.spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { lockAppDir } = await import(${JSON.stringify(NodePath.join(import.meta.dirname, "lock.ts"))});
       await lockAppDir(${JSON.stringify(appDir)});
       console.log("held");`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  using _stop = { [Symbol.dispose]: () => other.kill() };
  const [line] = await NodeEvents.EventEmitter.once(other.stdout, "data");
  expect(String(line).trim()).toBe("held");

  await expect(lockAppDir(appDir)).rejects.toThrow("Another scenario run is building");

  // It dies without releasing: the kernel frees the port, nothing stale is left to clear.
  other.kill("SIGKILL");
  await NodeEvents.EventEmitter.once(other, "exit");
  const release = await lockAppDir(appDir);
  // Both scenario projects' setups in this process share it.
  expect(await lockAppDir(appDir)).toBe(release);
  release();
});

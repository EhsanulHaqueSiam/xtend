import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";

// Shared by every copy of this module in the process: both scenario projects' setups in one vitest.
const held = ((
  globalThis as { xtendScenarioLocks?: Map<string, Promise<() => void>> }
).xtendScenarioLocks ??= new Map());

/** The checkout's own port, below every OS's ephemeral range so no outgoing connection holds it. */
const lockPort = (appDir: string) =>
  20_000 + (NodeCrypto.createHash("sha256").update(appDir).digest().readUInt32BE(0) % 10_000);

/**
 * One scenario run per app checkout: each run builds that checkout's web app and desktop in place,
 * and two at once would serve each other half-written bundles. The lock is a port only one process
 * can listen on: the kernel frees it when that process dies, so no lock is ever stale and taking it
 * is atomic. A second run fails at once; other checkouts run side by side. Resolves to the release.
 */
export function lockAppDir(appDir: string) {
  const known = held.get(appDir);
  if (known !== undefined) return known;
  const port = lockPort(appDir);
  const taking = new Promise<() => void>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Another scenario run is building ${appDir} (it holds 127.0.0.1:${port}). Wait for ` +
                "it to finish, or run this one from another worktree: every checkout gets its own " +
                "ports, homes and Electron.",
            )
          : error,
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      resolve(() => {
        held.delete(appDir);
        server.close();
      }),
    );
  });
  held.set(appDir, taking);
  taking.catch(() => held.delete(appDir));
  return taking;
}

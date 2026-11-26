import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { _electron, type Page } from "playwright";

import { APP_DIR } from "../appDir.ts";
import { startService, withTempDir } from "../harness.ts";
import { startMockX } from "../mockX/server.ts";

const DESKTOP = NodePath.join(APP_DIR, "apps/desktop");

/**
 * The built desktop on mock X: the real service (fake treg) on a temp base dir, mock X, and
 * Electron with `XTEND_MOCK_X` (main gives it a fresh profile) and no X account. `app` is the window's app
 * page; `engine(code)` runs a script in the x.com webview, as Xtend's engine scripts do.
 */
export const startEngine = (mockOptions?: Parameters<typeof startMockX>[0]) =>
  withTempDir("xtend-engine-", async (dir, undo) => {
    const service = await startService(dir, undo);
    const mock = await startMockX(mockOptions);
    undo.push(mock.close);
    const env: Record<string, string> = {};
    // None of the caller's XTEND_* reach this desktop (a cookie import, a dev URL, a debug port):
    // it runs only on what is set below.
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("XTEND_") && !k.startsWith("ELECTRON_RUN_AS_NODE"))
        env[k] = v;
    const electron = await _electron.launch({
      executablePath: NodeModule.createRequire(NodePath.join(DESKTOP, "package.json"))(
        "electron",
      ) as string,
      args: [DESKTOP],
      env: {
        ...env,
        XTEND_HOME: service.baseDir,
        XTEND_SERVICE_URL: service.url,
        XTEND_SERVICE_TOKEN: service.token,
        XTEND_MOCK_X: mock.url,
        // Hidden unless XTEND_HEADED=1: off the screen, out of focus, the same size on every host.
        XTEND_HEADLESS: process.env.XTEND_HEADED === "1" ? "0" : "1",
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
      timeout: 30_000,
    });
    // Playwright stops Electron by the process it started, never by name.
    undo.push(() => electron.close());
    // Main's own fresh profile for mock X; Playwright stops Electron before main can remove it.
    // Anything else is an app that ignored XTEND_MOCK_X: its profile may hold a real X login, so
    // it is never removed, and the app is stopped before a test can act on the real x.com.
    const profile = await electron.evaluate(({ app }) => app.getPath("userData"));
    if (!NodePath.basename(profile).startsWith("xtend-mock-x-"))
      throw new Error(`${DESKTOP} did not take a mock X profile (${profile}); it would load x.com`);
    undo.push(() => NodeFSP.rm(profile, { recursive: true, force: true }));
    const app: Page = await electron.firstWindow();
    app.setDefaultTimeout(10_000);
    await app.waitForURL((u) => u.origin === service.url);

    /** Runs `code` (an expression) in X's page in the webview; undefined while there is none. */
    const engine = <A = unknown>(code: string): Promise<A | undefined> =>
      electron.evaluate(
        ({ webContents }, script) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getType() === "webview" && !c.isDestroyed())
            ?.executeJavaScript(script),
        code,
      ) as Promise<A | undefined>;

    return { app, electron, engine, mock, service };
  });

export type Engine = Awaited<ReturnType<typeof startEngine>>;

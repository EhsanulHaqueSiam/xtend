import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { _electron, type Page } from "playwright";

import { APP_DIR } from "../appDir.ts";
import { startService, withTempDir } from "../harness.ts";
import { startMockX } from "../mockX/server.ts";

const DESKTOP = NodePath.join(APP_DIR, "apps/desktop");
/** Main's own temporary profile on mock X. A desktop built without it uses the default profile. */
const MOCK_PROFILE = "xtend-mock-x-";

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
    // A desktop from before mock X had its own profile (an old prove base) would load the real x.com
    // on a profile that may be signed in: refuse it before it starts.
    if (
      !NodeFS.readFileSync(NodePath.join(DESKTOP, "dist-electron/main.cjs"), "utf8").includes(
        MOCK_PROFILE,
      )
    )
      throw new Error(`${DESKTOP} predates mock X's own profile; it would load the real x.com`);
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
    // Main's fresh profile is removed once Electron has stopped (undo runs in reverse), and only
    // when it is that profile: anything else may hold a real X login.
    let profile: string | undefined;
    undo.push(async () => {
      if (profile !== undefined) await NodeFSP.rm(profile, { recursive: true, force: true });
    });
    // Playwright stops Electron by the process it started, never by name.
    undo.push(() => electron.close());
    const userData = await electron.evaluate(({ app }) => app.getPath("userData"));
    if (!NodePath.basename(userData).startsWith(MOCK_PROFILE))
      throw new Error(
        `${DESKTOP} did not take a mock X profile (${userData}); it would load x.com`,
      );
    profile = userData;
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

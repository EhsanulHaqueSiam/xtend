import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { _electron, type Page } from "playwright";

import { startService, withTempDir } from "../harness.ts";
import { startMockX } from "../mockX/server.ts";

const DESKTOP = NodeURL.fileURLToPath(new URL("../../../desktop/", import.meta.url));

/**
 * The built desktop on mock X: the real service (fake treg) on a temp base dir, mock X, and
 * Electron with `XTEND_MOCK_X`, its own user data and no X account. `app` is the window's app
 * page; `engine(code)` runs a script in the x.com webview, as Xtend's engine scripts do.
 */
export const startEngine = () =>
  withTempDir("xtend-engine-", async (dir, undo) => {
    const service = await startService(dir, undo);
    const mock = await startMockX();
    undo.push(mock.close);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && k !== "XTEND_DEV_URL" && !k.startsWith("ELECTRON_RUN_AS_NODE"))
        env[k] = v;
    const electron = await _electron.launch({
      executablePath: NodeModule.createRequire(NodePath.join(DESKTOP, "package.json"))(
        "electron",
      ) as string,
      args: [DESKTOP],
      env: {
        ...env,
        XTEND_HOME: service.baseDir,
        XTEND_USER_DATA: NodePath.join(dir, "user-data"),
        XTEND_SERVICE_URL: service.url,
        XTEND_SERVICE_TOKEN: service.token,
        XTEND_MOCK_X: mock.url,
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
      timeout: 30_000,
    });
    // Playwright stops Electron by the process it started, never by name.
    undo.push(() => electron.close());
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

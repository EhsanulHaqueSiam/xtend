// @effect-diagnostics nodeBuiltinImport:off -- the renders project writes its reports from Node.
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import * as Hash from "effect/Hash";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

import { TEST_DEFAULTS } from "../../vite.config.ts";

// scripts/dev-runner.ts picks both per checkout; a plain `vp dev` keeps the defaults.
const WEB_PORT = Number(process.env.XTEND_WEB_PORT ?? 5820);
const SERVICE_PORT = Number(process.env.XTEND_PORT ?? 4820);

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
    // `vp test bench` gives every project a "(bench)" twin; browser benches must not run in node.
    benchmark: {
      include: ["src/**/*.bench.{ts,tsx}"],
      exclude: ["src/**/*.browser.bench.{ts,tsx}"],
    },
  },
} satisfies TestProjectInlineConfiguration;

// Anything that renders React or touches the DOM is named *.browser.test.{ts,tsx} and runs
// in headless Chromium through the same plugins as the app, so it exercises compiled code.
// Vitest's fixed browser API port collides when two checkouts run browser tests at once,
// so the port is hashed from the checkout path into 61000-64999.
const browserTestApiPort = 61_000 + ((Hash.string(import.meta.dirname) >>> 0) % 4_000);

const browserTestProject = {
  extends: true,
  optimizeDeps: { include: ["vite-plus/test/browser"] },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    // Render benchmarks: measurements, not gates, so only `vp test bench` runs them.
    benchmark: { include: ["src/**/*.browser.bench.{ts,tsx}"] },
    setupFiles: ["./test/browserSetup.ts"],
    api: { port: browserTestApiPort, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
      commands: {
        // Playwright's mouse outlives each test, so whatever mounts under its last
        // position starts hovered. test/browserSetup.ts parks it off the page before each test.
        resetPointer: async ({ page }) => {
          await page.mouse.move(-1, -1);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

// Render scenarios count React commits and component renders; they run only through
// scripts/render-metrics.ts, which reads the per-scenario reports this command writes.
const renderScenariosProject = {
  ...browserTestProject,
  test: {
    ...browserTestProject.test,
    name: "renders",
    include: ["test/*.renders.tsx"],
    benchmark: { include: [] },
    // The counter must hook React before react-dom loads.
    setupFiles: ["./test/renderCounter.ts", ...browserTestProject.test.setupFiles],
    browser: {
      ...browserTestProject.test.browser,
      // Vitest names each instance in place, so a shared array would clash with the browser project.
      instances: [{ browser: "chromium" }],
      commands: {
        ...browserTestProject.test.browser.commands,
        writeRenderReport: async (_context, scenario: string, json: string) => {
          const directory = process.env.XTEND_RENDER_REPORT_DIR;
          if (directory === undefined) throw new Error("XTEND_RENDER_REPORT_DIR is not set");
          await NodeFSP.writeFile(`${directory}/${scenario}.json`, json);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

// Dev is single-origin: the web app talks to /ws and /api on its own origin and
// Vite proxies them to the service, so a remote browser works unchanged.
export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { "~": NodeURL.fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${SERVICE_PORT}`, ws: true },
      "/api": { target: `http://127.0.0.1:${SERVICE_PORT}` },
    },
  },
  build: {
    sourcemap: true,
  },
  test: {
    ...TEST_DEFAULTS,
    projects: [
      defineProject(unitTestProject),
      defineProject(browserTestProject),
      defineProject(renderScenariosProject),
    ],
  },
});

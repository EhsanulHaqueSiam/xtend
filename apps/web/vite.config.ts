import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import * as Hash from "effect/Hash";
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
    hookTimeout: 15_000,
    testTimeout: 15_000,
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
    projects: [defineProject(unitTestProject), defineProject(browserTestProject)],
  },
});

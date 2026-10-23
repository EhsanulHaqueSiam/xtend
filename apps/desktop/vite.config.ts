import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig, type UserConfig } from "vite-plus";

const isMainProcessExternal = (id: string) => id === "electron" || id.startsWith("electron/");
/** The main bundle carries every dependency (electron-updater included), so the packaged app ships no node_modules. */
const isMainProcessInlined = (id: string) => !isMainProcessExternal(id) && !id.startsWith("node:");
const launchAfterPack = process.env.XTEND_DESKTOP_DEV === "1";

type PackConfig = Exclude<NonNullable<UserConfig["pack"]>, ReadonlyArray<unknown>>;

const packDefaults: PackConfig = {
  format: "cjs",
  platform: "node",
  outDir: "dist-electron",
  dts: false,
  sourcemap: true,
  outExtensions: () => ({ js: ".cjs" }),
  external: isMainProcessExternal,
  // Electron loads this as CommonJS; workspace and ESM-only packages must be inlined.
  noExternal: [/^@xtend\//, /^effect(\/|$)/, /^zod(\/|$)/],
};

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["src/**/*.browser.test.ts"],
  },
} satisfies TestProjectInlineConfiguration;

// The overlay's DOM adapter runs against a saved x.com snippet in headless Chromium.
const browserTestProject = {
  extends: true,
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
    },
  },
} satisfies TestProjectInlineConfiguration;

export default defineConfig({
  test: {
    retry: 0,
    projects: [defineProject(unitTestProject), defineProject(browserTestProject)],
  },
  pack: [
    // Preloads are built on their own: a sandboxed preload cannot require a shared chunk.
    {
      ...packDefaults,
      entry: { preload: "src/preload.ts" },
    },
    {
      ...packDefaults,
      entry: { overlayPreload: "src/overlay/overlayPreload.ts" },
    },
    {
      ...packDefaults,
      noExternal: isMainProcessInlined,
      entry: { main: "src/main.ts" },
      ...(launchAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
  ],
});

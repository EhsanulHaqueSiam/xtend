import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const isMainProcessExternal = (id: string) => id === "electron" || id.startsWith("electron/");
const launchAfterPack = process.env.XTEND_DESKTOP_DEV === "1";

export default defineConfig({
  pack: [
    {
      entry: { main: "src/main.ts", preload: "src/preload.ts" },
      format: "cjs",
      platform: "node",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      external: isMainProcessExternal,
      // Electron loads this as CommonJS; workspace and ESM-only packages must be inlined.
      noExternal: [/^@xtend\//, /^effect(\/|$)/, /^zod(\/|$)/],
      ...(launchAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
  ],
});

import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const isMainProcessExternal = (id: string) => id === "electron" || id.startsWith("electron/");
const launchAfterPack = process.env.CORVID_DESKTOP_DEV === "1";

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
      ...(launchAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
  ],
});

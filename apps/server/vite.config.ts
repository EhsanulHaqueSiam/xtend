import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    pack: {
      entry: { bin: "src/bin.ts" },
      format: "esm",
      platform: "node",
      outDir: "dist",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".mjs" }),
    },
  }),
);

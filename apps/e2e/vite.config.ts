import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// `*.e2e.ts`, not `*.test.ts`: `pnpm test` and check:changed must not start browsers and services.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["src/**/*.e2e.ts"],
      globalSetup: ["src/globalSetup.ts"],
      // Each file boots its own service and Chromium before its journey runs.
      hookTimeout: 60_000,
      testTimeout: 60_000,
      expect: { poll: { timeout: 10_000 } },
    },
  }),
);

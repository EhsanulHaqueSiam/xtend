import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// `*.test.ts` are unit tests `pnpm test` runs. `*.e2e.ts` and `*.engine.ts` start services,
// browsers and Electron, so only their own commands run them (test:e2e, test:engine).
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      expect: { poll: { timeout: 10_000 } },
      projects: [
        { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"] } },
        {
          extends: true,
          test: {
            name: "e2e",
            include: ["src/**/*.e2e.ts"],
            // Each file boots its own service and Chromium before its journey runs.
            globalSetup: ["src/globalSetup.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "engine",
            include: ["src/**/*.engine.ts"],
            // The built web app and desktop: the desktop under test is the one that ships.
            globalSetup: ["src/engine/globalSetup.ts"],
            // One Electron at a time: each file starts its own desktop, service and mock X.
            fileParallelism: false,
          },
        },
      ],
    },
  }),
);

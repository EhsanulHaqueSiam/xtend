import tailwindcss from "@tailwindcss/vite";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

import { TEST_DEFAULTS } from "../../vite.config.ts";

export default defineConfig({
  plugins: [tailwindcss()],
  test: { ...TEST_DEFAULTS, environment: "node", include: ["src/**/*.test.ts"] },
});

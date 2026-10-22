import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const TEST_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

export default defineConfig({
  test: {
    environment: "node",
    exclude: TEST_EXCLUDE,
    // Flaky tests are fixed, not retried.
    retry: 0,
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "**/routeTree.gen.ts",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "**/routeTree.gen.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-underscore-dangle": "off",
      // AsyncResult.match callbacks return elements; they are not components.
      "react/no-unstable-nested-components": "off",
      "typescript/no-floating-promises": "off",
    },
  },
});

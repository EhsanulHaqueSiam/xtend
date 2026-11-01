import "vite-plus/test/config";
import { defineConfig, type TestUserConfig } from "vite-plus";

const TEST_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

/**
 * Test settings every package shares; apps/web and apps/desktop, which do not extend this config,
 * spread it into their own `test`.
 */
export const TEST_DEFAULTS = {
  // A stray `.only` would pass CI on a fraction of the suite.
  allowOnly: !process.env.CI,
  // The ceiling for a whole test. A test that needs its own timeout is waiting wrong.
  hookTimeout: 60_000,
  testTimeout: 60_000,
  // Flaky tests are fixed, not retried.
  retry: 0,
  // `vi.useFakeTimers()` fakes every clock a component or service reads, so a test advances
  // time instead of waiting for it.
  fakeTimers: {
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
    ],
  },
} satisfies TestUserConfig;

export default defineConfig({
  test: {
    ...TEST_DEFAULTS,
    environment: "node",
    exclude: TEST_EXCLUDE,
  },
  staged: {
    "*": ["vp fmt --no-error-on-unmatched-pattern", "vp lint --no-error-on-unmatched-pattern"],
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
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    // Xtend's own rules (packages/oxlint-plugin), ported from T3 Code's.
    jsPlugins: ["./packages/oxlint-plugin/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "oxc/no-accumulating-spread": "error",
      "eslint/no-control-regex": "off",
      "typescript/no-this-alias": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-string-starts-ends-with": "off",
      "unicorn/prefer-set-has": "off",
      "unicorn/prefer-array-find": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-array-reverse": "off",
      "react/no-object-type-as-default-prop": "off",
      "react/jsx-no-constructed-context-values": "off",
      "react/memo-dependencies": "error",
      "react/purity": "error",
      "react/refs": "error",
      "react/exhaustive-effect-dependencies": "error",
      "react/set-state-in-effect": "error",
      "react/immutability": "error",
      "react/no-array-index-key": "error",
      // AsyncResult.match callbacks return elements; they are not components.
      "react/no-unstable-nested-components": "off",
      "react/static-components": "error",
      "react/capitalized-calls": "error",
      "typescript/no-extraneous-class": "error",
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "unicorn/no-useless-spread": "error",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "xtend/no-inline-schema-compile": "error",
      "xtend/no-low-value-comments": "error",
      "xtend/no-manual-effect-runtime-in-tests": "error",
      "xtend/no-native-title-tooltip": "error",
      "xtend/no-polling-loop-in-tests": "error",
      "xtend/no-real-time-wait-in-tests": "error",
      "xtend/no-test-in-loop": "error",
      "xtend/no-test-timeout-or-unreasoned-skip": "error",
      "xtend/no-unscoped-has": "error",
      "xtend/no-wall-clock-in-tests": "error",
      "xtend/namespace-node-imports": "error",
      "xtend/prefer-catch-tags": "error",
      "xtend/prefer-effect-fn": "error",
      "xtend/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: ["**/*.{test,spec,testkit}.{ts,tsx}", "**/{test,tests,testkit,testing,fixtures}/**"],
        rules: { "xtend/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        rules: { "xtend/require-disposable-render": "error" },
      },
      {
        files: ["apps/*/src/**/*.browser.test.{ts,tsx}"],
        rules: { "xtend/no-frame-waits-in-browser-tests": "error" },
      },
      {
        files: ["**/*.browser.test.*"],
        rules: { "xtend/no-real-time-wait-in-tests": "off" },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
        rules: { "xtend/no-dom-test-environment": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "xtend/no-outset-state-indicators": "error" },
      },
      {
        files: ["apps/*/src/**", "packages/*/src/**"],
        excludeFiles: ["**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
        rules: { "xtend/no-em-dash-copy": "error" },
      },
      {
        files: ["apps/web/src/**", "packages/*/src/**"],
        rules: { "xtend/no-unreasoned-state-sync": "error" },
      },
    ],
  },
});

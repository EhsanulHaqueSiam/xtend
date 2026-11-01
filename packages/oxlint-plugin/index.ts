// Xtend's own lint rules, loaded by vite.config.ts `lint.jsPlugins`. Ported from T3 Code's
// oxlint-plugin-t3code; rule ids are `xtend/<rule>`.
import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";
import noDomTestEnvironment from "./rules/no-dom-test-environment.ts";
import noEmDashCopy from "./rules/no-em-dash-copy.ts";
import noFrameWaitsInBrowserTests from "./rules/no-frame-waits-in-browser-tests.ts";
import noInlineSchemaCompile from "./rules/no-inline-schema-compile.ts";
import noLowValueComments from "./rules/no-low-value-comments.ts";
import noManualEffectRuntimeInTests from "./rules/no-manual-effect-runtime-in-tests.ts";
import noNativeTitleTooltip from "./rules/no-native-title-tooltip.ts";
import noUnreasonedStateSync from "./rules/no-unreasoned-state-sync.ts";
import noOutsetStateIndicators from "./rules/no-outset-state-indicators.ts";
import noPollingLoopInTests from "./rules/no-polling-loop-in-tests.ts";
import noRealTimeWaitInTests from "./rules/no-real-time-wait-in-tests.ts";
import noTestInLoop from "./rules/no-test-in-loop.ts";
import noTestTimeoutOrUnreasonedSkip from "./rules/no-test-timeout-or-unreasoned-skip.ts";
import noUnscopedHas from "./rules/no-unscoped-has.ts";
import noWallClockInTests from "./rules/no-wall-clock-in-tests.ts";
import preferCatchTags from "./rules/prefer-catch-tags.ts";
import preferEffectFn from "./rules/prefer-effect-fn.ts";
import requireDisposableRender from "./rules/require-disposable-render.ts";
import requireSuppressionReason from "./rules/require-suppression-reason.ts";

export default definePlugin({
  meta: {
    name: "xtend",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-dom-test-environment": noDomTestEnvironment,
    "no-em-dash-copy": noEmDashCopy,
    "no-frame-waits-in-browser-tests": noFrameWaitsInBrowserTests,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-low-value-comments": noLowValueComments,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-native-title-tooltip": noNativeTitleTooltip,
    "no-unreasoned-state-sync": noUnreasonedStateSync,
    "no-outset-state-indicators": noOutsetStateIndicators,
    "no-polling-loop-in-tests": noPollingLoopInTests,
    "no-real-time-wait-in-tests": noRealTimeWaitInTests,
    "no-test-in-loop": noTestInLoop,
    "no-test-timeout-or-unreasoned-skip": noTestTimeoutOrUnreasonedSkip,
    "no-unscoped-has": noUnscopedHas,
    "no-wall-clock-in-tests": noWallClockInTests,
    "prefer-catch-tags": preferCatchTags,
    "prefer-effect-fn": preferEffectFn,
    "require-disposable-render": requireDisposableRender,
    "require-suppression-reason": requireSuppressionReason,
  },
});

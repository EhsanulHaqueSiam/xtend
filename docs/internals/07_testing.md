# Testing

Rules for writing tests and for asking for them in review, adapted from T3 Code's. AGENTS.md links
here from Verifying; lint enforces the waiting rules.

## What to test

- Test behavior that can break: the capture's parsing of X's responses, the engine store's merge,
  money paths (cost, budget, spend), scheduling and automations, persistence and migrations, auth,
  race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee,
  trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to
  static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an
  assertion there. Write a new `it` only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Don't repeat the case in a wrapper test or
  at each call site.
- Proof for a bug fix depends on the bug. Logic, data, state and protocol bugs get a failing test
  first (the fewest that fail on `main` for that reason), then the fix. Purely visual bugs get
  before/after captures and no test. A service-only fix with no visible surface ships the test plus
  a short runtime transcript.
- Engine work (what the session view loads, reads or presses on x.com) is proven end to end on mock
  X (`pnpm test:engine`, see [Mock X](../operations/00_development.md#mock-x) and
  [Scenarios](#scenarios)), and against
  x.com itself only live: the engine bench on a signed-in dev desktop (see
  [03_native-shell.md](03_native-shell.md#the-engine) and the `test-xtend-app` skill). Its parsing and
  store logic still get unit tests from recorded X responses.
- In review, ask for a missing test only when it would catch a real regression. Flag a new test that
  breaks these rules and name the fix: fold it into an existing case, delete it, or keep one layer.

## Waiting for work

Never wait on sleeps or polling. A test that needs a timeout to pass is wrong.

- `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`.
  `it.live` is wall-clock and only for real subprocess or network fixtures. Code under test reads
  time from Effect's `Clock` (or `DateTime.now`), never `Date.now()`, so it runs on the test clock.
- No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or read the
  store state that marks the milestone.
- No per-test timeout or `retry`. The project timeout is the ceiling; flaky tests are fixed, not
  retried.
- No `Date.now()`, `new Date()` or `performance.now()` for "now" or for deltas. Fix the time with
  `vi.setSystemTime` under fake timers, or `TestClock`. Assert on events and counts, not elapsed
  time.
- `it.skip` and friends need a tracking issue on the line above: `// quarantine: #12 <why>`.
- Lint enforces this: `xtend/no-real-time-wait-in-tests`, `xtend/no-wall-clock-in-tests`,
  `xtend/no-polling-loop-in-tests`, `xtend/no-test-timeout-or-unreasoned-skip`,
  `xtend/no-test-in-loop`, `xtend/no-manual-effect-runtime-in-tests`.

## Browser tests

Anything that renders React or touches the DOM is `*.browser.test.{ts,tsx}` and runs in headless
Chromium. Screens render against a fake service with
`await using screen = await render(ui, { service })` from
[`apps/web/test/render.tsx`](../../apps/web/test/render.tsx); `xtend/require-disposable-render`
rejects the old patterns.

- Assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame`, `transitionend` or
  a `setTimeout` promise (`xtend/no-frame-waits-in-browser-tests`).
- Time: `using _timers = fakeTimers()` from the render module fakes every clock (the project's
  `fakeTimers.toFake` is the full set), then advance it.
- Acquire what the test drives after mounting (fake timers it advances, spies) after the render, so
  it disposes before the unmount. Anything the first render reads comes before it.
- No lifecycle hooks and no module-level mutable state. Shared mock state is reset by a `setup()`
  call at the top of the test. Globals go through `using _x = stubGlobal(name, value)`.
- `rerender` needs a fresh element on every call.

## Scenarios

Scenarios are the tests in [`scripts/scenarios`](../../scripts/scenarios) that drive the real app:
`*.e2e.ts` journeys start the service on a fake treg and open the web app in headless Chromium
(`pnpm test:e2e`); `*.engine.ts` start the built desktop on mock X with no X account
(`pnpm test:engine`). Nothing in them reaches X, treg or a model, so they need no account, token or
login.

- Each test file starts its own service, temp home, fake treg, mock X and Electron on free ports.
  The desktop runs hidden (`XTEND_HEADLESS`): no window, Dock icon or tray, and the same window size
  on every host, since a tiling window manager would otherwise resize it and change the layout.
  `XTEND_HEADED=1 pnpm test:engine` shows it, to watch a failure.
- Worktrees run scenarios side by side. Within one checkout, one run at a time: a run builds that
  checkout's web app and desktop in place, and a second run fails at once, naming the first.
- Seed through the service (`rpc` and `observe` from
  [`harness.ts`](../../scripts/scenarios/harness.ts)) or mock X's state, not by writing the
  database, so the test meets real events.
- Assert only the behavior the bug breaks. A page or button mock X lacks is taught to mock X first,
  from how X does it (Mobbin, the engine bench's recordings), never invented.
- `pnpm prove scripts/scenarios/<file> [--base origin/main] [-t "<name>"]` is the real-app proof
  for a bug a user can reproduce. It runs the scenario against the base's app (a detached worktree
  beside this one, at the merge base) and then against this checkout's, and exits `0` only when it
  fails on the base and passes here (`1` not proved, `2` the base could not be set up). The
  scenario, mock X and fake treg always come from this checkout; `XTEND_SCENARIO_APP_DIR` picks
  the app.
- Scenarios cannot prove how x.com itself behaves (the engine bench does, live), visuals (captures
  do), or timing and performance (`pnpm bench`, `pnpm bench:scroll`).

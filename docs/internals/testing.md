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
- Engine work (what the session view loads, reads or presses on x.com) can only be proven live: the
  engine bench against a signed-in dev desktop (see
  [native-shell.md](native-shell.md#the-engine) and the `test-xtend-app` skill). Its parsing and
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

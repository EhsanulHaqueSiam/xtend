# Contributing

The path a change takes from idea to release, for people and agents alike. AGENTS.md holds the
rules; this is the order to apply them in.

## 1. Set up

- `pnpm i` once. In a T3 Code worktree the `Setup Worktree` script does it (see `t3.json`); wait for
  `.t3/setup-done`.
- [First checkout](docs/operations/development.md#first-checkout) covers the tools (Node from
  `mise.toml`, pnpm, Xcode or the Linux build tools for packaging).
- T3 Code shows the common commands as script buttons from `t3.json`: dev, the desktop, checks,
  the engine bench, screenshots, packaging.

## 2. Establish the problem

- For an X flow, look at how X does it first: `docs/operations/x-parity-mobbin.md`.
- Reproduce it on safe data: `pnpm dev` (seeded demo data, paid lanes fake),
  `pnpm dev --fixture <name>` for one named state, `?engine=all` for X screens without the desktop.
  A bug worth seeing again gets a fixture in `scripts/fixtures`.
- [Dev data and UI states](docs/operations/development.md#dev-data-and-ui-states) has every command.

## 3. Make one change

- One problem per branch and PR. Branch names: `feat/…`, `fix/…`, `chore/…`.
- Server code follows [Effect services](docs/internals/effect-services.md); screens follow
  AGENTS.md "Where code lives" and [design](docs/internals/design.md). Walk AGENTS.md
  "Hit every surface" before calling it done.
- Never touch `~/.xtend`, never press X's write buttons from a script, never run a paid call
  without its cost shown (AGENTS.md "Ways to hurt yourself").

## 4. Prove it

- [Testing](docs/internals/testing.md): a logic bug gets a failing test first; a visual bug gets
  before/after captures; nothing waits on sleeps or the wall clock.
- `vp test run <files>` while iterating; `pnpm check:changed` before pushing (format, lint, typecheck
  of what the change reaches, knip, the tests beside it, the payload budgets; a rerun on the same
  input is instant).
- UI: one pass in the real app through the `test-xtend-app` skill, then `pnpm capture` for
  before/after (main's checkout and the branch, same fixture, same `--clock`).
- Engine work: the engine bench, three clean runs five minutes apart, on a signed-in dev desktop.

## 5. Commit and open the PR

- Conventional commit titles in plain words: `feat(web): …`, `fix(desktop): …`, `chore: …`. The body
  says the problem, then the fix. No AI attribution lines. The pre-commit hook formats and lints the
  staged files.
- The PR follows `.github/pull_request_template.md`: Problem, Change, Verification. Upload
  screenshots and recordings to the PR; CI rejects committed PR evidence.
- CI runs only what the change reaches and sums it up in one `Check` job. A payload that grows needs
  `payloadBudget.json` updated and the `payload-increase` label.

## 6. Merge and release

- Merge when `Check` is green and review findings are answered (fixed, or dismissed with a reason).
- Every merge to main that touches the app ships a nightly after CI passes on that commit. A `vX.Y.Z`
  tag on a commit already on main ships stable. [CI and releases](docs/operations/development.md#ci-and-releases)
  has the details, and `pnpm dist:desktop:dmg:arm64 && pnpm release:smoke` checks a package
  locally.

# Xtend

Xtend is a desktop-first X (Twitter) growth suite: one app whose sidebar holds both X and the tools. x.com runs inside it as the user's own logged-in session, reskinned with CSS, and a local service adds analytics, a composer with a queue, a viral library, engagement targets, lead lists, automations and account scores. The architecture copies T3 Code: a headless Node service owns data and all X calls; thin web and Electron clients connect to it over WebSocket RPC.

## Glossary

- **service** means the headless `xtend` process in `apps/server`: SQLite, scheduler, automations, treg and X calls, agent runs.
- **client** means the web UI (`apps/web`) or the Electron shell (`apps/desktop`) that wraps it.
- **session view** means the x.com `<webview>` inside the desktop window, on the account's cookie partition. It is the only place the user's X session exists; the service never holds X cookies. Under Xtend's own X screens (Home, Search, Post) it is the **engine**, off screen; on X pages Xtend does not draw yet it sits over the main area, and in the side panel beside the tools. See `docs/internals/native-shell.md`.
- **skin** means the CSS the desktop inserts into the session view to hide X's own navigation and right column. CSS only, never script.
- **observation** means a post, author or metric row the desktop read from the session view's own traffic and sent to the service. Observations are passive: nothing is replayed to X.
- **account** means one connected X handle. All data is scoped to an account.

## What we never compromise on

1. **The session view acts only for the user's own clicks.** It is the X engine under Xtend's own X screens: it loads and scrolls the X pages the user opens in Xtend, at the user's pace, and the desktop reads what X sends it. It writes only for an action the user just clicked (a like, a reply, a post), one at a time through X's own button, and only while the session-actions setting is on (the default). Rules, agents and anything unattended never use it: they go through the X API. Nothing ever calls X's API with the session's cookies.
2. **Free first, and every paid action shows its cost before it runs** and is capped by a budget. A capability takes the cheapest correct lane (session, then API, then a model) and the button says which. X API calls go through treg; the user pays from their treg balance. No second wallet.
3. **One service, every surface.** A capability is a service method. The WebSocket handler, HTTP route, MCP tool, CLI command and scheduled task all call that method. Logic in a handler is a bug.
4. **Performance.** No continuously repainting animations, no oversized WebSocket payloads, no unvirtualized long lists.

## Where code lives

- `packages/contracts` - Effect Schema contracts and the RPC group. Anything that crosses the wire is typed here first.
- `apps/server` - the service. Effect-heavy. Foundation services every screen uses: `x/Treg.ts` (the only HTTP door to treg: token, budget, read cache, spend log), `x/XClient.ts` (typed X reads and writes, every call names its `purpose`), `ai/Assist.ts` (one structured-output model call; screens pass instructions, input and an output schema), `settings/SettingsStore.ts` (handle, token, budget, voice notes, keywords, spend).
- Each suite area (compose, plan, analyze, scores, library, engage, leads, automate) owns `packages/contracts/src/<area>.ts` (schemas, method names, its RpcGroup, merged into `WsRpcGroup`), `apps/server/src/<area>/<Area>Handlers.ts` (`layer` for its services, `layerHandlers` for its rpcs, both pre-merged in `server.ts` and `ws.ts`), one migration per area pair, and its own routes, components and state files in `apps/web`. Adding a screen never edits another screen's files. Read [Effect services](docs/internals/effect-services.md) before adding server code.
- `apps/web` - React, Vite, TanStack Router, Tailwind 4, `@effect/atom-react`. The desktop wraps it.
- Screens share one shape: `PageHeader` on top (the open section's name, plain-word filters, actions), then `components/ui/layout.tsx` (`PageBody`, `Section`, `Empty`, `Cost`, `Stat`, `table`). A tool's sections live in `components/shell/sections.ts` and show as rows under it in the sidebar; the page reads the open one with `useSection` and never draws its own tab row. Groups are a label and a hairline, not a card. Shared pieces live in `components/ui/` (`split.tsx` list plus detail column, `menu.tsx`, `popover.tsx`, `switch.tsx`, `field.tsx`, `x-link.tsx` to open a post on X beside the tool, `no-handle.tsx`); use them before writing a local one.
- `apps/pool` - the Cloudflare Worker in front of the shared pool (Neon Postgres through Hyperdrive): issues install ids, takes observation batches, serves trends. The only thing that holds the pool's credentials. `pnpm --filter @xtend/pool deploy`.
- `apps/desktop` - Electron. Loads the app as the window, gates and wires the x.com webview, runs or connects to the service, captures observations.

## Conventions

- Effect modules are imported as namespaces from subpaths: `import * as Effect from "effect/Effect"`. Service modules are imported as namespaces too: `import * as ObservationStore from "./ObservationStore.ts"`, then `yield* ObservationStore.ObservationStore` and `ObservationStore.layer`.
- A service module is: imports, errors and schemas, the `Context.Service` class, `make`, `layer`. Dependencies come from the environment, never as parameters.
- Reusable Effect functions are `Effect.fn("Service.operation")`. `Effect.gen` stays inline.
- Errors are `Schema.TaggedError` with bounded attributes and the underlying failure in `cause`.
- Inferred types over annotations. `any` is the enemy.
- Comments say why. Not what, not how. Default to none; four lines at most.
- Conventional commit titles: `feat(desktop): capture home timeline observations`.

## Ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID found by matching a name, path or worktree string: your own agent process has the worktree path in its argv, and this machine runs other checkouts' dev desktops and services. Kill only a PID you captured at spawn, or the owner of your port after checking its cwd is your checkout.
2. **Touching the live install.** `~/.xtend` and the installed app's Electron profile (its `x-session` partition holds the user's X cookies) are in use while you work. Reading and copying from them is fine. Never start a service against them, open them read-write, or clean them up. Two services on one database both run the scheduler and post the same drafts.
3. **Writing to X.** A dev desktop is the user's real account. Never press like, reply, repost, follow, vote, post or a menu row from a script; only the user's click does that. The engine bench presses nothing but one bookmark it removes again.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** A sidebar section, the command palette, a keybinding, a post's "...", the side panel.
- **Clients.** The web app alone in a browser, the desktop's app page, and the session view under it. Web has no engine: X screens must say so, not break.
- **Lanes.** Session, API and model. Each capability takes the cheapest correct lane; a paid one shows its cost and is budget-capped.
- **Transports.** WebSocket, HTTP, MCP, CLI and scheduled jobs call the same service method.
- **Accounts.** Everything is scoped to one account; switching accounts must not leak another's data.
- **Contracts.** Anything crossing the wire changes in `packages/contracts` first.
- **Reverse states.** A way in needs the way out and the way to see it: queue and unqueue, follow and unfollow, enable and disable.
- **Docs.** Does the change make existing guidance inaccurate?

## Dev

- In a T3 worktree, `scripts/setup-worktree.ts` installs in the background (`t3.json`). While `.t3/setup-running` names a live PID, wait for it and do not install yourself. It ends with `.t3/setup-done` or `.t3/setup-failed` (with the error tail). With no marker at all, setup never ran here, so run `pnpm i`.
- `pnpm i` installs. `pnpm dev` runs the service and the web app on this checkout's own port pair (read the real ports from its output). `pnpm dev:desktop` builds the Electron main and launches it against the dev web server.
- Service state lives in `~/.xtend` by default; `--base-dir` overrides it. Dev runs use `<repo>/.xtend`, which is gitignored.
- Need a second checkout? `git worktree add` it next to this one, not in `/tmp`, and remove it when done.

## Verifying

- `pnpm check:changed` before you push: format, lint, knip, typecheck of the packages your change reaches, and the tests beside changed files. CI runs the full suites. While iterating, `vp test run <files>` (`-t "<name>"` for one case).
- **Do not run repo-wide checks** (`vp run -r test`, `pnpm test`, `pnpm typecheck`) unless asked. CI owns the full suite.
- Lint gates: errors and warnings both fail. A suppression needs `-- <reason>`; a React effect needs one saying what it syncs with.
- [Testing](docs/internals/testing.md) holds the rules. The short form:
  - Test behavior that can break, at the lowest layer that fails on `main`; extend an existing case before adding one. No tests for types, copy, wiring or static markup.
  - A logic, data or state bug gets a failing test first, then the fix. A visual bug gets before/after captures and no test. A service-only fix gets its test plus a short runtime transcript.
  - Never wait on sleeps, polling or timeouts: `it.effect` with `TestClock`, await the `Deferred` or event, fake timers in browser tests. Lint enforces it.
  - Screen tests are `*.browser.test.tsx` and render against a fake service: `await using screen = await render(ui, { service })`. See `docs/operations/development.md#screen-tests`.
- Engine work (what the session view loads, reads or presses) is proven live with the engine bench on a signed-in dev desktop, three clean runs five minutes apart; the `test-xtend-app` skill shows how. Name the result in the PR.
- User-visible changes get one integrated pass in the real app through `test-xtend-app`, by the primary agent after integrating. Subagents do not launch their own dev servers or desktops.
- Paid lanes (treg, X API, models) spend the user's balance. Prefer fake-service tests and seeded observations; use a paid call only when the change depends on it, and say what it cost.

## Pull requests

- Title: a conventional commit in plain words, `fix(web): new threads no longer spike CPU`. One problem per PR.
- Body (`.github/pull_request_template.md`): the problem in a sentence or two, then the fix, then what you ran and saw. UI changes carry before/after captures; motion or timing a short recording. Upload evidence to GitHub; never commit PR-only assets (CI rejects `.github/pr-assets/`).
- `Check` is the one required CI job. Babysitting a PR: verify each bot finding against the source, fix real ones, dismiss false positives with a written reason, stay quiet when nothing is new.

## X parity references (Mobbin MCP)

Before building or checking any X flow, see how X does it in Mobbin's recording of X's web app. `docs/operations/x-parity-mobbin.md` lists all 151 flows by section with their Mobbin links: grep it for the flow, then make one call, `mcp__mobbin__search_flows` with `platform: "web"`, `query: "X <exact flow name>"`, `limit: 1` (a single menu or dialog: `mcp__mobbin__search_screens`, `limit: 2`). Results carry images at 1 to 2K tokens each, so keep limits low, batch lookups in a text-only subagent, and paste each new link into the index.

## Documentation

Most code changes do not need a documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, keep file catalogs, or append PR summaries. Types, tests and code record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code cannot show goes in a short nearby comment. An internal doc is for reasoning that crosses boundaries. Link to the source instead of copying it.
- When a documented decision changes, rewrite or remove the affected text. Do not append another account of the new behaviour.
- `docs/user/` helps users accomplish tasks: what a feature does, how to start, what costs money, and anything unintuitive. A settings path is useful; descriptions of buttons, layouts or every UI state are not. Keep the shipped product's voice, no implementation details.
- `docs/operations/` holds maintainer setup, release and debugging procedures.

## Do not

- Commit plans, research or agent scratch files. Keep them outside the worktree.
- Add a dependency for a few lines.
- Add X API or treg calls outside `apps/server/src/x/`. Never call a provider or hold a token anywhere but `x/Treg.ts`.
- Build a chat-style agent. AI lives inside screens as assist actions through `ai/Assist.ts`.
- Run a paid action without showing its cost first. `XClient.postCostUsd` and X's rate card are the source.
- Touch `~/.xtend` from a dev server. Point dev at `<repo>/.xtend`.

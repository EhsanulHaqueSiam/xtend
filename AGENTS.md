# Xtend

Xtend is a desktop-first X (Twitter) growth suite: one app whose sidebar holds both X and the tools. x.com runs inside it as the user's own logged-in session, reskinned with CSS, and a local service adds analytics, a composer with a queue, a viral library, engagement targets, lead lists, automations and account scores. The architecture copies T3 Code: a headless Node service owns data and all X calls; thin web and Electron clients connect to it over WebSocket RPC.

## Glossary

- **service** means the headless `xtend` process in `apps/server`: SQLite, scheduler, automations, treg and X calls, agent runs.
- **client** means the web UI (`apps/web`) or the Electron shell (`apps/desktop`) that wraps it.
- **session view** means the x.com `<webview>` inside the desktop window, on the account's cookie partition. It is the only place the user's X session exists; the service never holds X cookies. It sits over the main area on X's pages and in the side panel beside the tools. See `docs/internals/native-shell.md`.
- **skin** means the CSS the desktop inserts into the session view to hide X's own navigation and right column. CSS only, never script.
- **observation** means a post, author or metric row the desktop read from the session view's own traffic and sent to the service. Observations are passive: nothing is replayed to X.
- **account** means one connected X handle. All data is scoped to an account.

## What we never compromise on

1. **The session view is read-only by default.** The desktop may read what X already sent to the user's browser. It never posts, likes, follows or DMs through the session unless the user turned on the session-posting setting, and automations never use it.
2. **Every paid action shows its cost before it runs** and is capped by a budget. X API calls go through treg; the user pays from their treg balance. No second wallet.
3. **One service, every surface.** A capability is a service method. The WebSocket handler, HTTP route, MCP tool, CLI command and scheduled task all call that method. Logic in a handler is a bug.
4. **Performance.** No continuously repainting animations, no oversized WebSocket payloads, no unvirtualized long lists.

## Where code lives

- `packages/contracts` - Effect Schema contracts and the RPC group. Anything that crosses the wire is typed here first.
- `apps/server` - the service. Effect-heavy. Foundation services every screen uses: `x/Treg.ts` (the only HTTP door to treg: token, budget, read cache, spend log), `x/XClient.ts` (typed X reads and writes, every call names its `purpose`), `ai/Assist.ts` (one structured-output model call; screens pass instructions, input and an output schema), `settings/SettingsStore.ts` (handle, token, budget, voice notes, keywords, spend).
- Each suite area (compose, plan, analyze, scores, library, engage, leads, automate) owns `packages/contracts/src/<area>.ts` (schemas, method names, its RpcGroup, merged into `WsRpcGroup`), `apps/server/src/<area>/<Area>Handlers.ts` (`layer` for its services, `layerHandlers` for its rpcs, both pre-merged in `server.ts` and `ws.ts`), one migration per area pair, and its own routes, components and state files in `apps/web`. Adding a screen never edits another screen's files. Read `docs/internals/effect-services.md` in T3 Code (vendored reference at `~/Work/ref/t3code`) before adding server code; the same rules apply here.
- `apps/web` - React, Vite, TanStack Router, Tailwind 4, `@effect/atom-react`. The desktop wraps it.
- Screens share one shape: `PageHeader` on top (the open section's name, plain-word filters, actions), then `components/ui/layout.tsx` (`PageBody`, `Section`, `Empty`, `Cost`, `Stat`, `table`). A tool's sections live in `components/shell/sections.ts` and show as rows under it in the sidebar; the page reads the open one with `useSection` and never draws its own tab row. Groups are a label and a hairline, not a card. Shared pieces live in `components/ui/` (`split.tsx` list plus detail column, `menu.tsx`, `popover.tsx`, `switch.tsx`, `field.tsx`, `x-link.tsx` to open a post on X beside the tool, `no-handle.tsx`); use them before writing a local one.
- `apps/desktop` - Electron. Loads the app as the window, gates and wires the x.com webview, runs or connects to the service, captures observations.

## Conventions

- Effect modules are imported as namespaces from subpaths: `import * as Effect from "effect/Effect"`. Service modules are imported as namespaces too: `import * as ObservationStore from "./ObservationStore.ts"`, then `yield* ObservationStore.ObservationStore` and `ObservationStore.layer`.
- A service module is: imports, errors and schemas, the `Context.Service` class, `make`, `layer`. Dependencies come from the environment, never as parameters.
- Reusable Effect functions are `Effect.fn("Service.operation")`. `Effect.gen` stays inline.
- Errors are `Schema.TaggedError` with bounded attributes and the underlying failure in `cause`.
- Inferred types over annotations. `any` is the enemy.
- Comments say why. Not what, not how.
- Conventional commit titles: `feat(desktop): capture home timeline observations`.

## Dev

- In a T3 worktree, `scripts/setup-worktree.ts` installs in the background (`t3.json`). While `.t3/setup-running` names a live PID, wait for it and do not install yourself. It ends with `.t3/setup-done` or `.t3/setup-failed` (with the error tail). With no marker at all, setup never ran here, so run `pnpm i`.
- `pnpm i` installs. `pnpm dev` runs the service and the web app. `pnpm dev:desktop` builds the Electron main and launches it against the dev web server.
- Service state lives in `~/.xtend` by default; `--base-dir` overrides it. Dev runs use `<repo>/.xtend`, which is gitignored.
- `pnpm check:changed` before you hand work back: it checks only what you changed. Otherwise `vp run typecheck` (tsc-rs), `vp test run <files>`, `vp lint`, `vp fmt`. Do not run repo-wide checks unless asked.
- Screen tests render against a fake service: `render(ui, { service })`. See `docs/operations/development.md#screen-tests`.
- Backend behaviour ships with a focused test beside it. Visual changes ship with a screenshot.

## Do not

- Commit plans, research or agent scratch files. Keep them outside the worktree.
- Add a dependency for a few lines.
- Add X API or treg calls outside `apps/server/src/x/`. Never call a provider or hold a token anywhere but `x/Treg.ts`.
- Build a chat-style agent. AI lives inside screens as assist actions through `ai/Assist.ts`.
- Run a paid action without showing its cost first. `XClient.postCostUsd` and X's rate card are the source.
- Touch `~/.xtend` from a dev server. Point dev at `<repo>/.xtend`.

# Xtend

Xtend is a desktop-first X (Twitter) growth suite: the X web app lives in the middle of the window, and a local service adds analytics, a composer with a queue, a viral library, engagement targets, lead lists, automations and account scores around it. The architecture copies T3 Code: a headless Node service owns data and all X calls; thin web and Electron clients connect to it over WebSocket RPC.

## Glossary

- **service** means the headless `xtend` process in `apps/server`: SQLite, scheduler, automations, treg and X calls, agent runs.
- **client** means the web UI (`apps/web`) or the Electron shell (`apps/desktop`) that wraps it.
- **session view** means the logged-in x.com `WebContentsView` the desktop embeds. It is the only place the user's X session exists; the service never holds X cookies.
- **observation** means a post, author or metric row the desktop read from the session view's own traffic and sent to the service. Observations are passive: nothing is replayed to X.
- **account** means one connected X handle. All data is scoped to an account.

## What we never compromise on

1. **The session view is read-only by default.** The desktop may read what X already sent to the user's browser. It never posts, likes, follows or DMs through the session unless the user turned on the session-posting setting, and automations never use it.
2. **Every paid action shows its cost before it runs** and is capped by a budget. X API calls go through treg; the user pays from their treg balance. No second wallet.
3. **One service, every surface.** A capability is a service method. The WebSocket handler, HTTP route, MCP tool, CLI command and scheduled task all call that method. Logic in a handler is a bug.
4. **Performance.** No continuously repainting animations, no oversized WebSocket payloads, no unvirtualized long lists.

## Where code lives

- `packages/contracts` - Effect Schema contracts and the RPC group. Anything that crosses the wire is typed here first.
- `apps/server` - the service. Effect-heavy. Read `docs/internals/effect-services.md` in T3 Code (vendored reference at `~/Work/ref/t3code`) before adding server code; the same rules apply here.
- `apps/web` - React, Vite, TanStack Router, Tailwind 4, `@effect/atom-react`. The desktop wraps it.
- `apps/desktop` - Electron. Creates the window, runs or connects to the service, embeds the session view, captures observations.

## Conventions

- Effect modules are imported as namespaces from subpaths: `import * as Effect from "effect/Effect"`. Service modules are imported as namespaces too: `import * as ObservationStore from "./ObservationStore.ts"`, then `yield* ObservationStore.ObservationStore` and `ObservationStore.layer`.
- A service module is: imports, errors and schemas, the `Context.Service` class, `make`, `layer`. Dependencies come from the environment, never as parameters.
- Reusable Effect functions are `Effect.fn("Service.operation")`. `Effect.gen` stays inline.
- Errors are `Schema.TaggedError` with bounded attributes and the underlying failure in `cause`.
- Inferred types over annotations. `any` is the enemy.
- Comments say why. Not what, not how.
- Conventional commit titles: `feat(desktop): capture home timeline observations`.

## Dev

- `pnpm i` installs. `pnpm dev` runs the service and the web app. `pnpm dev:desktop` builds the Electron main and launches it against the dev web server.
- Service state lives in `~/.xtend` by default; `--base-dir` overrides it. Dev runs use `<repo>/.xtend`, which is gitignored.
- `vp run typecheck` (tsc-rs), `vp test run <files>`, `vp lint`, `vp fmt`. Do not run repo-wide checks unless asked.
- Backend behaviour ships with a focused test beside it. Visual changes ship with a screenshot.

## Do not

- Commit plans, research or agent scratch files. Keep them outside the worktree.
- Add a dependency for a few lines.
- Add X API or treg calls outside `apps/server/src/x/`.
- Touch `~/.xtend` from a dev server. Point dev at `<repo>/.xtend`.

# Architecture

Xtend keeps the user's X session in the desktop and everything else in a service. Clients
control the service over WebSocket RPC; the service never holds X cookies.

## Ownership boundaries

- **The service** (`apps/server`) owns SQLite, the scheduler, automations, agents, and every
  treg and X API call. It serves the web app and the RPC on one port.
- **The desktop** (`apps/desktop`) owns the window, which loads the app, and the x.com webview
  inside it, plus the capture pipeline. It reads GraphQL responses the webview already received
  through the Chrome DevTools Protocol and posts normalized observations to the service over
  HTTP. It does not inject scripts into x.com's world and never replays requests to X.
- **The web app** (`apps/web`) is the UI for both the browser and the desktop. In the desktop
  its sidebar lists X's pages and the tools, and it places the x.com webview over the main area
  or beside a tool (see [native-shell.md](./native-shell.md)); in a browser it has the same
  sidebar without X, and Home shows what the session observed.

The [RPC contract](../../packages/contracts/src/rpc.ts) is the boundary between independently
versioned clients and the service.

## Why observations are passive

Reading what x.com sent to the user's own browser is indistinguishable from the browser
itself, so it carries no suspension risk. Automation that writes to X goes through the official
API via treg, where it is declared and billed. The desktop's session-posting toggle is the one
deliberate exception and is off by default.

## Why CDP and not a preload hook

A preload runs in an isolated world and cannot see the page's `fetch`. Patching `fetch` in the
main world is visible to x.com's scripts. The DevTools Protocol reads response bodies after the
fact without touching the page. It breaks when X renames GraphQL operations, which is why the
normalizer walks for tweet-shaped objects instead of knowing paths, and why unknown shapes yield
nothing rather than wrong numbers.

## Service auth

Every mutating surface of the service needs a bearer token: the WebSocket RPC upgrade and
`POST /api/observations`. `GET /api/health` stays open. The token is generated on first start
and kept at `<base dir>/auth-token` (mode 600); whoever can read the base dir can drive the
service, and a page served from anywhere else cannot. On top of the token the service checks
`Origin` against the dev URL (`--dev-url`) and its own origin, so a leaked token from a foreign
page is still refused. Non-browser callers send no `Origin` and pass on the token alone.

How each client gets it:

- **Desktop**: reads `<base dir>/auth-token`, where the base dir is `--base-dir`, then
  `XTEND_HOME`, then `~/.xtend`, in the same order the service resolves it. `XTEND_SERVICE_TOKEN`
  overrides the file, and a remote service's token comes from the desktop's own config. The
  capture pipeline sends it as `Authorization: Bearer`, and the preload hands it to the web app.
- **HTTP API, CLI, MCP**: `POST /api/rpc/<method>` with the bearer token; see
  [api.md](../operations/api.md).
- **Remote browser**: opens the service URL once with `?token=`; the client keeps it in
  sessionStorage and strips it from the address bar.
- **Packaged web app**: the service serves `index.html` itself and injects
  `<meta name="xtend-token">`; the client reads the tag and opens `/ws?token=`.
- **Web dev server**: the page POSTs `/api/auth/dev-token`, which the service only serves when a
  dev URL is configured and only to that origin (Vite proxies the call; browsers always send
  `Origin` on POST).

The treg token is encrypted at rest in SQLite with a key at `<base dir>/secret-key` (mode 600),
so a copied database does not leak it.

Remote debugging (`XTEND_REMOTE_DEBUG`) is honoured only in unpackaged desktop builds: with the
port open, any local process can attach to the x.com target and read its cookies.

## Service supervision

The desktop makes sure a service answers before it opens its window
(`apps/desktop/src/service/ServiceSupervisor.ts`): a remote URL is only probed, a loaded
`com.xtend.service` launchd agent is waited for, and otherwise the service runs as a child of
the desktop (Electron as Node, `XTEND_SUPERVISOR=child`), restarted with backoff and killed on
quit. `xtend service install` writes the launchd agent so schedules fire with the app closed.
The service reports `supervisor` in `server.info`; Settings shows it together with how the
desktop reached the service (child, launchd, remote, none).

The desktop keeps its own `config.json` in userData with the remote service URL and token, so
a window can point at a Mac mini or VPS without the local DB knowing. Changing it relaunches
the app.

## Accounts

`accounts` plus `settings.current_account_id` (migration 014). Every per-account table has an
`account_id`; reads compare it with `(SELECT current_account_id FROM settings)` and an insert
trigger stamps new rows with the current account, so a switch is one UPDATE. Selecting an
account also sets `settings.handle`, which every handle-scoped screen reads. The desktop
opens one session partition per account (`persist:x-session-<id>`; account 1 keeps the
original `persist:x-session` so an existing login survives) and rebuilds the window on a
switch. Scheduled work (queued drafts, agent and rule ticks) runs for the current account.

## Money

`apps/server/src/budget/Budget.ts` is the one budget gate. Treg and Assist reserve the quoted
price under a semaphore before a call and settle what the provider charged afterwards, so
concurrent callers cannot overshoot the monthly budget. When treg sends no cost, the quoted price
is charged rather than zero. Prices live only in `XClient.RATE_CARD`; clients ask the
`costs.quote` rpc for the rate card and per-action quotes, which also say when the read cache
would make a click free.

## Time

`settings.timeZone` (IANA, default: the service machine's zone) is the zone for posting slots,
the calendar, schedule triggers and the best-time heatmap. The service does every conversion;
clients render instants in that zone and never use the browser's.

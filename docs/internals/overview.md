# Architecture

Xtend keeps the user's X session in the desktop and everything else in a service. Clients
control the service over WebSocket RPC; the service never holds X cookies.

## Ownership boundaries

- **The service** (`apps/server`) owns SQLite, the scheduler, automations, agents, and every
  treg and X API call. It serves the web app and the RPC on one port.
- **The desktop** (`apps/desktop`) owns the window, the embedded x.com `WebContentsView`, and
  the capture pipeline. It reads GraphQL responses the session view already received through the
  Chrome DevTools Protocol and posts normalized observations to the service over HTTP. It does not
  inject scripts into x.com and never replays requests to X.
- **The web app** (`apps/web`) is the UI for both the browser and the desktop. In the desktop,
  the Home route reserves an area and reports its bounds; the desktop paints the session view
  there. In a browser, Home shows what the session observed instead.

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
  overrides the file. The capture pipeline sends it as `Authorization: Bearer`.
- **Packaged web app**: the service serves `index.html` itself and injects
  `<meta name="xtend-token">`; the client reads the tag and opens `/ws?token=`.
- **Web dev server**: the page POSTs `/api/auth/dev-token`, which the service only serves when a
  dev URL is configured and only to that origin (Vite proxies the call; browsers always send
  `Origin` on POST).

The treg token is encrypted at rest in SQLite with a key at `<base dir>/secret-key` (mode 600),
so a copied database does not leak it.

Remote debugging (`XTEND_REMOTE_DEBUG`) is honoured only in unpackaged desktop builds: with the
port open, any local process can attach to the x.com target and read its cookies.

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

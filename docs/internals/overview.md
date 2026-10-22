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

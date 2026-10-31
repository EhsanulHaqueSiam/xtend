# Native shell

The window is the Xtend app. x.com is one `<webview>` inside it, on the account's cookie
partition: the user's own logged-in browser session. Browsing X through it costs nothing and
looks to X like an ordinary Chromium tab. Xtend's sidebar is the one navigation for X's pages
and the tools; X's own rail and right column are hidden by a CSS skin.

## Window and webview

`apps/desktop/src/window/MainWindow.ts`, rules in `window/guestPolicy.ts` (tested).

- The `BrowserWindow` loads the app (`preload.cjs`, `webviewTag: true`). On macOS the title bar
  is `hiddenInset`; the sidebar's top row is the drag region and clears the traffic lights.
- The app page creates the webview itself (`components/shell/XPane.tsx`), once, by hand rather
  than through React, so its partition is set before the first navigation and no render ever
  recreates it.
- `will-attach-webview` is the gate: `hardenXWebview` refuses anything but x.com on the current
  account's partition, and forces the overlay preload, `sandbox`, `contextIsolation` and no node
  integration, whatever the page asked for.
- `did-attach-webview` wires the guest: Chromium's user agent without the Electron and app
  tokens, the skin on every `dom-ready`, the window-open and navigation rules (x.com stays
  inside, Google and Apple sign-in get a popup on the same partition, everything else opens in
  the default browser), the context menu, downloads, the key rules, the capture and the desktop
  commands. A new guest (an account switch rebuilds the window) detaches the old one first.

## The engine

Home, Search, Post, Bookmarks and profiles are Xtend's own screens (`components/xnative/`), drawn from what the
session view receives, the way T3 Code draws Claude's work: X is the engine, Xtend the
interface. The screen moves the off-screen webview to the matching x.com page (and picks
Home's tab); the capture turns each GraphQL response into posts with media, video variants,
quotes and parents (`renderPostsFromGraphql`) and sends them to the app page on
`xtend:engine`, never to the service. Reaching the end of a list scrolls X's own page so X
fetches the next one, at most every 1.5s. A like, repost or bookmark presses X's own button on
the engine page where the post already sits (`xActInPlace`, matched by the article whose
timestamp links to the post, since a quoting post links to it too), so the engine never leaves
the list it feeds. Only when the post is not there (X's timeline has no bookmark button) does it
open the post's page, press it, and put the engine back. A reply goes through the existing
session command and the screen restores the engine after it; posts X sends again are
deduplicated. Video plays from X's mp4 in Xtend's player, so fullscreen and picture
in picture are the browser's own. Pages Xtend does not draw yet (notifications, messages,
lists) still show x.com itself.

## Where x.com sits

`components/shell/AppShell.tsx` is a three-column grid: sidebar, main area, X panel. The pane
moves between them with CSS only, never in the DOM, because moving a webview reloads it.

| route             | pane                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `/x` (and `/`)    | over the main area; the route renders nothing                             |
| a tool, panel on  | the right column, `xPanelWidthAtom` wide (360-760, dragged from its edge) |
| a tool, panel off | parked under the app at the panel's width, session and scroll intact      |

Parked means under the app, transparent and click-through, never off screen or `invisible`:
Chromium draws no frames for a frame outside the viewport, and X's infinite scroll and video
wait on frames, so a hidden engine would never load the next page.

`⌘\` toggles the panel; from `/x` it returns to the last tool with the panel open. The panel
bar shows the path and has back, forward, reload, full size (`/x`), open in browser and close.
The sidebar's X rows (Home, Notifications, Messages, Bookmarks, Profile) load their page in the
webview and go to `/x`; a page the webview already shows is only revealed, since `loadURL` is a
full reload, and a second click where it shows reloads it.

The panel follows the open section (`XPanelFollow` in `AppShell.tsx`, the map is `xPageFor` in
`sections.ts`): a section with an X page opens the panel on it, one without closes it, and
browsing inside the panel never moves it back. A route sent from x.com (Reply with AI, Full
report) holds X where it is, because the user opened it from the post they are reading. Notifications shows X's unread count, read from the "(3) Home / X" page
title. `state/x.ts` holds the webview's functions (`xNavigate`, `xBack`, `xFind`) and atoms
(`xUrlAtom`, `xUnreadAtom`, the panel's open state and width, the skin switch).

## The skin

`apps/desktop/src/overlay/xSkin.ts`, inserted with `insertCSS` on every full load. CSS only, so
x.com's code runs untouched and nothing is clicked or fetched. It hides X's nav rail, its right
column and the Premium and Grok prompts, centres the timeline at 640px and styles scrollbars
and selection with Xtend's tokens. X serves two clients: the long-standing one keyed by
`data-testid` (what signed-in users get as of 2026-10) and a newer one built from `main` and
`aside` in a grid (what signed-out pages get). Each has its own block. `:has()` cannot nest,
which is why the newer client's row is found by its grid's `main + aside`; that pair also keeps
the rule away from the legacy client's layers div, where X's menus and modals live.
`xSkin.browser.test.ts` fails when a rule stops parsing. The app can switch the skin off
(`xSkinAtom`, `bridge.setXSkin`).

## Keys

In x.com (`before-input-event` on the guest, `guestKey`): `⌘K` palette, `⌘\` X panel and `⌘F`
find are sent to the app; `⌘[` `⌘]` go back and forward, `⌘=` `⌘-` `⌘0` zoom, `⌥O` toggles the
metrics strips. Single letters stay X's own (j, k, l, r). In the app (`ShellHotkeys`) the same
chords work, and letters outside text fields open screens: c Compose, p Plan, a Analyze,
e Engage, l Library, s Library search, r reply, x X.

## Channels

`apps/desktop/src/ipc/channels.ts`

- app -> main: `xtend:glance` (the composer chip's best time), `xtend:x-skin` (boolean),
  `xtend:open-external`, the account and remote channels, `xtend:bridge-info` (sync).
- main -> app: `xtend:app-route` (deep links and the injections), `xtend:shortcut`
  (`palette`, `xPanel`, `find`), `xtend:session-download`.
- main <-> overlay preload: `xtend:overlay-data`, `xtend:overlay-toggle`, `xtend:overlay-hide`,
  `xtend:overlay-glance`, and `xtend:overlay-action` (`save` or `openRoute`) back.

The bridge the app sees (`apps/web/src/desktopBridge.ts`) adds `xPartition`, `xStartUrl` and
`initialRoute` (a deep link that arrived before the page loaded) to the service details.

## Native injections

`apps/desktop/src/overlay/overlayPreload.ts` runs in the webview's isolated world. It reads the
DOM X already rendered and never clicks, scrolls or fetches. Every X selector lives in `xDom.ts`
with its fixture test; a missing landmark drops that one injection.

| injection     | where                                       | does                                                                |
| ------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| metrics row   | after each post's action row                | views, ER, views/h, followers, vs your average; Save, Reply with AI |
| Schedule chip | composer toolbar, before Post               | opens `/compose?text=` with what was typed                          |
| hover card    | on an author's avatar or name, after 400 ms | followers; Full report opens `/scores`                              |

They sit in closed shadow roots styled with Xtend's tokens and carry `data-xtend`. Routes they
open arrive through `xtend:app-route`, and the shell opens the X panel beside them so X stays in
view. The chip's best time comes from `GlanceSync`, which derives it from free reads only.

## Dev capture

`XTEND_REMOTE_DEBUG=<port>` on an unpackaged build opens DevTools; `node
apps/desktop/scripts/cdp.mjs shot|eval|click|type` drives it. The app page and the x.com webview
are separate targets (`localhost:<web port>` and `x.com`); a screenshot of the app page includes
the webview. Keys sent through DevTools skip `before-input-event`, so drive the chords on the
app page. `XTEND_SHOT_DIR` plus `kill -USR2 <pid>` writes the window to `<ts>.png`.

A dev desktop in a worktree uses its own Electron profile (`.xtend/electron`), so it starts
signed out of X. Copying `Partitions/x-session` from an installed app's profile (minus its
caches) into it signs it in.

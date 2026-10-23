# Native shell

x.com is the window. The React app is one `WebContentsView` ("xtend view") that the main
process moves between slots over it, so Xtend's UI appears where X would draw it: the suite
screens as an X page in the primary column, the palette and bars as layers over it. There is
no sidebar, URL bar or session view in the app any more; standalone (hosted tier, browser
tests) keeps the sidebar because it has no bridge.

## Window and view

`apps/desktop/src/window/MainWindow.ts`

- The `BrowserWindow`'s own web contents load x.com on the account's session partition with
  the isolated-world preload (`overlayPreload.cjs`). Everything that used to apply to the child
  session view (user agent, cookie import, downloads, context menu, zoom and history keys,
  CDP capture, desktop commands, overlay feed) now applies to the window.
- The window title stays "Xtend" (`page-title-updated` is prevented). On macOS the title bar is
  `hiddenInset`; `BANNER_INSET_CSS` from `xDom.ts` pads X's rail so the logo clears the traffic
  lights.
- The xtend view is created once with the window, loads the app with `preload.cjs`, has a
  transparent background, and is never destroyed: hidden means empty bounds, so its socket,
  live events and atoms stay warm. The bridge-info `sendSync` answers only this view.

## Slots

`apps/desktop/src/window/Slots.ts` is pure geometry and dismissal rules, tested in
`Slots.test.ts`. Main owns the open slot; the app only asks for "route R in slot S".

| kind      | bounds                                                                           | closes on                              |
| --------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| `center`  | X's primary column, full height; fallback a 600px column centered in the window  | pointer-down in x.com, Esc, back arrow |
| `popover` | 340x320 below the anchor's left edge, flips above without room, clamped, 8px gap | pointer-down, Esc                      |
| `sheet`   | 680x480 bottom-center                                                            | pointer-down, Esc                      |
| `palette` | 640x420 top-center at y=80                                                       | pointer-down, Esc, ⌘K again            |
| `bar`     | column x and width, y 0, height 44                                               | pointer-down, Esc, Enter in the bar    |
| `toast`   | 360x64 bottom-center, 24px margin                                                | the app's own `closeSlot` only         |

One slot is open at a time. Opening a slot focuses the xtend view; closing it focuses x.com.
Main resends the current x.com URL on every open, so the address bar prefills correctly.

The column rect comes from the x.com preload: a `ResizeObserver` on
`div[data-testid="primaryColumn"]` plus the window resize event, re-found on every mutation
scan because X remounts the column on route changes. Main multiplies it by the zoom factor.
On pages without the column (DMs, settings) the fallback column is used.

## Channels

`apps/desktop/src/ipc/channels.ts`

- x.com preload -> main: `xtend:column-rect` (`Rect | null`), `xtend:pointer-down`,
  `xtend:overlay-action` (`save` or `openSlot`), `xtend:editing`.
- main -> x.com preload: `xtend:overlay-data`, `xtend:overlay-toggle`, `xtend:overlay-hide`,
  `xtend:overlay-glance` (resent after every full load).
- app view -> main: `xtend:slot-open` (`{ kind, route, anchor? }`), `xtend:slot-close`
  (`{ kind? }`: a named kind only closes itself, so a stale close cannot hide a newer slot),
  `xtend:session-navigate` (url), `xtend:session-find`, `xtend:open-external`,
  `xtend:editing`, `xtend:glance` (`Glance`), plus the account and remote channels.
- main -> app view: `xtend:slot` (`{ kind | null, route }`), `xtend:session-url`,
  `xtend:session-find-result`, `xtend:session-download`, `xtend:shortcut`.

The bridge the app sees (`apps/web/src/desktopBridge.ts`): `slot` (state at load), `onSlot`,
`openSlot`, `closeSlot`, `pushGlance`, `navigateSession`, `sessionFind`, `openExternal`, `onSessionUrl`,
`onSessionFindResult`, `onSessionDownload`, `onShortcut`, `checkRemote`, `setRemote`,
`selectAccount`.

## Native injections

`apps/desktop/src/overlay/overlayPreload.ts` adds Xtend to X's own chrome. Every X selector
lives in `xDom.ts` with its fixture test; a missing landmark drops that one injection.

| injection   | where                                                      | does                                                                |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| metrics row | after each post's action row                               | views, ER, views/h, followers, vs your average; Save, Reply with AI |
| rail item   | X's Home item cloned, before Premium (or Profile, or More) | opens the center slot on `/plan`                                    |
| Schedule    | composer toolbar, before Post, in every composer           | opens `/compose?text=` with what was typed                          |
| Today card  | right column, above the first card (Premium or Trending)   | queue, mentions, spend, service; each row opens a tab               |

The rail item is a plain clone so it inherits X's styles and icon-only collapse; everything
else sits in a closed shadow root styled with X's tokens (system font, 13px `#71767b` rows,
`#2f3336` hairlines, 16px card radius). Each added element carries `data-xtend`, and a
pointer-down whose composed path holds one does not dismiss the open slot. The Schedule chip
acts on pointer-down because focusing a collapsed composer makes X remount its toolbar before
a click would land.

The Today card and the chip's best time come from the app view, not the server:
`GlanceSync` (`apps/web/src/components/shell/GlanceSync.tsx`) derives a `Glance` from queued
drafts, slots, stored mentions and the spend summary, all free, formats times in the account
zone (`lib/glance.ts`) and pushes it through the bridge whenever it changes.

## Shortcuts

In x.com (`before-input-event` on the window's contents): ⌘K toggles the palette slot, C/P/A/E/L
outside text fields open the center slot on `/compose`, `/plan`, `/analyze`, `/engage`,
`/library`, ⌘F opens `bar` `/bar/find`, ⌘L opens `bar` `/bar/address`, Esc closes the open
slot, ⌥O toggles the overlay strips, ⌘= ⌘- ⌘0 zoom and ⌘[ ⌘] go back and forward.

In the app view, `ShellHotkeys` handles the same letters and ⌘K through the bridge, and Esc
asks main to close the open slot (unless a menu or dialog already took the key). ⌘F, ⌘L and ⌥O
are intercepted by main there too.

## App in slot mode

`apps/web/src/components/shell/SlotShell.tsx` replaces `AppSidebar` whenever
`window.desktopBridge` exists. `html.slot` in `index.css` overrides the palette with X's tokens
and makes the page transparent. `slotAtom` (`state/shell.ts`) mirrors main's state; the shell
navigates to the slot's route whenever a slot opens.

- `center`: X's page header (back arrow calls `closeSlot`, "Xtend") and tab row (Plan, Compose,
  Engage, Leads, Library, Scores, More: Analyze, Automate, Seen, Settings). Tabs call
  `openSlot` so main stays the source of truth. Hairlines left and right.
- `palette`: `/palette` renders `PaletteBody`; a pick opens the center slot, which replaces the
  palette.
- `bar`: `/bar/find` and `/bar/address`.
- `popover`, `sheet`, `toast`: ringed, rounded frames around `<Outlet />`; routes come later.

## Adding a slot route

1. Add the route file under `apps/web/src/routes/`; the frame comes from `SlotShell`, so the
   page renders only its content.
2. Open it from the app with `bridge.openSlot({ kind, route, anchor? })`, from the x.com preload
   with an `openSlot` overlay action, or from main with `openSlot` on the window handle.
3. Close it with `bridge.closeSlot({ kind })` from the page, or let pointer-down and Esc do it.

## Dev capture

With `XTEND_SHOT_DIR` set on an unpackaged build, `kill -USR2 <electron pid>` writes
`<ts>.png` (x.com), `<ts>-slot.png` (the xtend view, when a slot is open) and `<ts>.json`
(the slot's bounds). A window capture does not include child views, so compose them, e.g.
`magick x.png slot.png -geometry +X+Y -composite out.png`. Keys injected through the DevTools
protocol skip Electron's `before-input-event`, so shortcuts cannot be driven through CDP; the
bridge (`window.desktopBridge.openSlot(...)` evaluated in the app view) can. Without a display
session, CDP mouse events right after a load or a layout change are dropped; evaluating
`document.elementFromPoint(x, y)` just before `Input.dispatchMouseEvent` makes them land.
`apps/desktop/scripts/cdp.mjs click` does both.

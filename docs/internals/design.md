# Design system

The approved spec with mocks lives outside the repo (Postplan, linked from the touchup PRs).
This page keeps the decisions a maintainer would otherwise undo.

## One look

True black canvas, white text. Every group on a page is one panel (`components/ui/layout.tsx`,
`Section`): `--card` (#0a0a0a), hairline border, 12px radius. Panels never nest; inside one,
hairlines divide. Rows inside a panel start at its padding: tables and lists inset their ends
by `--row-inset`, which is the page margin on the canvas and 0 inside a `Section`. Hairlines
are alpha white (`--border`), so one line reads the same on the canvas and on a panel. Empty
states sketch three faint static rows above one line on where the data comes from.

Controls take an 8px corner through one token, `--control-radius`. Header filters are plain
words with a faint thumb on the open one (`PageHeader`, `HeaderTabs`). The primary button is
white on black and carries its price inside, in mono.

The sidebar groups tools under Create, Grow and Measure, each row with its icon. Counts are
small chips; a count that waits on the user (Automate approvals) is solid white.

Charts are an SVG area with a vertical gradient under a 2px line, no grid, three labels
(`analyze/ui.tsx`, `LineChart`). Stats sit in one panel with dividers (`statRow`), value in
mono at 22px, label under it.

## Freshness

Every page that fetches says how fresh its data is in the header (`Freshness`): live from the
session needs no button; fetched data shows its age; only stale or missing data turns the paid
button solid. Nothing refreshes itself for money.

## Motion

Keyboard actions never animate. Only transform and opacity animate, under 300ms, with
ease-out. No pulse, shimmer or blur loops: a loading state is a static row or a mono counter.
Values and labels that change in place morph with Torph, which respects reduced motion on
its own. Rare moments may have one spring: a drag ghost settling, a stamp on a posted card.

## Drag model

Anything with a URL or an id is draggable; a drop target is a sidebar row, a column, a slot, a
list or an editor. The sidebar watches the window for a link drag (the data is only readable on
drop) and shows each target's verb while the rest fade (`shell/drops.ts`, `lib/drag.ts`). One
toast (`ui/toast.tsx`) reports a drop with Undo where the service can reverse it. Drops read
only what the session observed and never call X.

## References

Panels, sidebar groups and two-line cells follow ObsidianUI and PaceUI. Base: uiarc.dev for rows, bencho.dev for stats and charts, 23rd.dev for tables,
boardui.com for boards, audiocn.dev for the day ruler, termcn.dev for logs, spaceui.one (Base
UI, which Xtend already uses) for sortable lists, kanban, calendar and the heat grid. FeralUI
and Torph supply the few physical moments. Control Panel for Twitter inspired Clean X, under
the CSS-only rule.

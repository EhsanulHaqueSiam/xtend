# Design system

The approved spec with mocks lives outside the repo (Postplan, linked from the touchup PRs).
This page keeps the decisions a maintainer would otherwise undo.

## One look

True black canvas, white text. Every group on a page is one raised surface
(`components/ui/layout.tsx`, `Section`): `--card` background, hairline border, 16px radius,
and a numbered label driven by a CSS counter on `PageBody`, so sections count from 01 per
page and per detail column (`split.tsx` resets it). Inside a surface, hairlines divide;
surfaces never nest. Companion cards (`XCard`) are the same surface.

Every control is a pill through one token, `--control-radius: 999px`. Buttons, inputs,
sidebar rows and palette rows all follow it; a textarea keeps a soft corner. Header filters
are a segmented pill (`PageHeader`, `HeaderTabs`) with a white thumb. The primary button is
white on black and carries its price inside, in mono.

Charts are an SVG area with a vertical gradient under a 2px line, no grid, three labels
(`analyze/ui.tsx`, `LineChart`). Stats sit in one surface with dividers (`statRow`), value in
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

Base: uiarc.dev for pills and rows, bencho.dev for stats and charts, 23rd.dev for tables,
boardui.com for boards, audiocn.dev for the day ruler, termcn.dev for logs, spaceui.one (Base
UI, which Xtend already uses) for sortable lists, kanban, calendar and the heat grid. FeralUI
and Torph supply the few physical moments. Control Panel for Twitter inspired Clean X, under
the CSS-only rule.

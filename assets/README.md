# Brand assets

Xtend has one mark, drawn in `currentColor` so it follows light and dark. Its sources live here, by
release channel, as T3 Code keeps its own:

- `prod/icon.svg`: the mark. The source of truth.
- `prod/icon.png`: the 1024×1024 app icon. electron-builder reads it for every platform
  (`apps/desktop/electron-builder.yml`); there is no copy in the app.

Copies made from these:

- `apps/web/public/favicon.svg` and `apps/marketing/public/favicon.svg`: `pnpm icons` writes them
  from `prod/icon.svg`, and CI fails when one drifts (`pnpm icons --check`).
- `apps/web/src/components/ui/logo.tsx`: the same drawing inline, for the sidebar. Change it with
  the SVG.

Stable and nightly builds share these today. A nightly or dev icon of its own gets a `nightly/` or
`dev/` folder beside `prod/` and its own copy rules in `scripts/icons.ts`. Like any UI change, it
starts from an approved mock.

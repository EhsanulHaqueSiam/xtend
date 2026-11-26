// The brand mark has one source, assets/prod/icon.svg; the web and marketing favicons are copies
// Vite serves from each app's public dir. This writes them, or with --check (CI) fails when one
// drifted. The desktop reads assets/prod/icon.png directly (electron-builder.yml).

//   pnpm icons [--check]
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.dirname(import.meta.dirname);

export const ICON_COPIES = [
  { from: "assets/prod/icon.svg", to: "apps/web/public/favicon.svg" },
  { from: "assets/prod/icon.svg", to: "apps/marketing/public/favicon.svg" },
] as const;

/** The copies whose content differs from their source, under `dir`. */
export const driftedIn = (dir: string) =>
  ICON_COPIES.filter(({ from, to }) => {
    const copy = NodePath.join(dir, to);
    return (
      !NodeFS.existsSync(copy) ||
      !NodeFS.readFileSync(copy).equals(NodeFS.readFileSync(NodePath.join(dir, from)))
    );
  });

if (import.meta.main) {
  const drifted = driftedIn(root);
  if (process.argv.includes("--check")) {
    for (const { from, to } of drifted) console.error(`${to} differs from ${from}: run pnpm icons`);
    process.exit(drifted.length === 0 ? 0 : 1);
  }
  for (const { from, to } of drifted) {
    NodeFS.copyFileSync(NodePath.join(root, from), NodePath.join(root, to));
    console.log(`${to} <- ${from}`);
  }
}

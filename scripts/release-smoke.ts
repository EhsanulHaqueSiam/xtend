// Checks that every packaged macOS app in apps/desktop/release carries what it needs at runtime:
// the Electron main and both preloads inside app.asar, the web app and the service bundle beside
// it as extra resources. The dmg and the zip are made from these .app directories.
//   pnpm dist:desktop:dmg:arm64 && pnpm release:smoke
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const release = NodePath.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const IN_ASAR = [
  "package.json",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "dist-electron/overlayPreload.cjs",
];
const IN_RESOURCES = ["apps/web/dist/index.html", "apps/server/dist/bin.mjs"];

interface AsarEntry {
  readonly files?: Readonly<Record<string, AsarEntry>>;
}

// app.asar opens with Chromium pickles: the JSON header's length is at byte 12, the header at 16.
const asarHeader = (file: string): AsarEntry => {
  const bytes = NodeFS.readFileSync(file);
  return JSON.parse(bytes.toString("utf8", 16, 16 + bytes.readUInt32LE(12))) as AsarEntry;
};

const apps = (NodeFS.existsSync(release) ? NodeFS.readdirSync(release) : [])
  .filter((name) => name.startsWith("mac"))
  .map((name) => NodePath.join(release, name, "Xtend.app"))
  .filter((app) => NodeFS.existsSync(app));
if (apps.length === 0) {
  console.error(`release-smoke: no Xtend.app under ${release}. Run pnpm dist:desktop:dmg first.`);
  process.exit(1);
}

const missing = apps.flatMap((app) => {
  const resources = NodePath.join(app, "Contents", "Resources");
  const header = asarHeader(NodePath.join(resources, "app.asar"));
  const inAsar = (path: string) => {
    let entry: AsarEntry | undefined = header;
    for (const name of path.split("/")) entry = entry?.files?.[name];
    return entry !== undefined;
  };
  return [
    ...IN_ASAR.filter((path) => !inAsar(path)).map((path) => `app.asar/${path}`),
    ...IN_RESOURCES.filter((path) => !NodeFS.existsSync(NodePath.join(resources, path))),
  ].map((path) => `${NodePath.relative(release, app)}: ${path}`);
});

for (const app of apps) console.log(`release-smoke: checked ${NodePath.relative(release, app)}`);
if (missing.length > 0) {
  console.error(`release-smoke: missing\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

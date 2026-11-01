// @effect-diagnostics globalConsole:off -- a dev CLI: it prints file paths for a person.
// Screenshots of the running dev web app for PR evidence: every route at every viewport, on a fixed
// clock so times read the same before and after. Run it on main's checkout for "before" and on the
// branch for "after" against the same fixture; files land outside the repo, never in a commit.

//   pnpm capture --routes "/compose,/home?engine=home" --label after
//   pnpm capture --routes /today --viewports 1440x900,390x844 --clock 2026-10-28T09:00:00Z
//   pnpm capture --url http://localhost:5820 --routes /plan --out /tmp/shots
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { chromium } from "playwright";

const root = NodePath.resolve(import.meta.dirname, "../../..");
const { values } = NodeUtil.parseArgs({
  options: {
    url: { type: "string" },
    routes: { type: "string", default: "/today" },
    viewports: { type: "string", default: "1440x900" },
    clock: { type: "string" },
    label: { type: "string", default: "after" },
    out: { type: "string" },
    full: { type: "boolean", default: false },
  },
});

/** The dev web app this checkout's `pnpm dev` recorded, unless --url names one. */
const webUrl = () => {
  if (values.url !== undefined) return values.url;
  const record = NodePath.join(root, ".xtend", "dev-ports.json");
  if (!NodeFS.existsSync(record)) {
    console.error("capture: no running `pnpm dev` recorded here; start it or pass --url.");
    process.exit(1);
  }
  const { web } = JSON.parse(NodeFS.readFileSync(record, "utf8")) as { web: number };
  return `http://localhost:${web}`;
};

const branch = NodeChildProcess.execFileSync("git", ["branch", "--show-current"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const out =
  values.out ??
  NodePath.join(
    NodeOS.homedir(),
    "Pictures",
    "xtend-ui",
    branch.replaceAll("/", "-") || "detached",
  );
NodeFS.mkdirSync(out, { recursive: true });

const viewports = values.viewports.split(",").map((v) => {
  const [width, height] = v.split("x").map(Number);
  if (!width || !height) throw new Error(`capture: bad viewport ${v}, want WIDTHxHEIGHT`);
  return { width, height };
});
const routes = values.routes.split(",").map((r) => r.trim());
const slug = (route: string) =>
  route
    .replace(/^\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-$/, "") || "root";

const base = webUrl();
const browser = await chromium.launch();
const written: Array<string> = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, colorScheme: "dark" });
    const page = await context.newPage();
    if (values.clock !== undefined) await page.clock.setFixedTime(new Date(values.clock));
    for (const route of routes) {
      await page.goto(new URL(route, base).href, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const file = NodePath.join(
        out,
        `${values.label}-${slug(route)}-${viewport.width}x${viewport.height}.png`,
      );
      await page.screenshot({ path: file, fullPage: values.full });
      written.push(file);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
// Markdown embeds for the reply or the PR body (upload the files first for a PR).
for (const file of written) console.log(`![${NodePath.basename(file, ".png")}](${file})`);

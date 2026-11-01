// Serves a folder of release files (latest-mac.yml, latest-linux.yml and the builds they name) as
// an update feed, so a dev desktop shows its update states without publishing a release. Point the
// desktop at it: XTEND_UPDATE_FEED=http://127.0.0.1:<port> pnpm dev:desktop. A feed version above
// apps/desktop/package.json's offers an update; macOS links to it, Linux downloads it.

//   node scripts/mock-update-server.ts [--root ../release-mock] [--port 3000]
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

/** The file a request path names inside `root`, or null for anything outside it or not a file. */
export function fileFor(root: string, requestUrl: string | undefined): string | null {
  const raw = (requestUrl ?? "/").split("?", 1)[0] ?? "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const rootReal = NodeFS.realpathSync(root);
  const file = NodePath.resolve(rootReal, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  // Symlinks are followed before the check, so one cannot point out of the folder.
  const real = NodeFS.existsSync(file) ? NodeFS.realpathSync(file) : null;
  if (real === null || !NodeFS.statSync(real).isFile()) return null;
  const inside = NodePath.relative(rootReal, real);
  return inside.startsWith("..") || NodePath.isAbsolute(inside) ? null : real;
}

/** A server answering every GET with the file it names under `root`, 404 otherwise. */
export const serveFolder = (root: string) =>
  NodeHttp.createServer((request, response) => {
    const file = fileFor(root, request.url);
    if (file === null) return void response.writeHead(404).end("Not Found");
    response.writeHead(200, { "content-length": NodeFS.statSync(file).size });
    NodeFS.createReadStream(file).pipe(response);
  });

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      root: {
        type: "string",
        default: NodePath.resolve(import.meta.dirname, "../../release-mock"),
      },
      port: { type: "string", default: "3000" },
    },
  });
  if (!NodeFS.existsSync(values.root)) {
    console.error(`mock-update-server: no folder at ${values.root}; pass --root.`);
    process.exit(1);
  }
  serveFolder(values.root).listen(Number(values.port), "127.0.0.1", () =>
    console.log(`mock-update-server: ${values.root} on http://127.0.0.1:${values.port}`),
  );
}

import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { logLoadsAndCrashes, makeDesktopLog } from "./desktopLog.ts";

const tempLog = () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-desktop-log-"));
  onTestFinished(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  return NodePath.join(dir, "logs", "desktop.log");
};

const allLines = (file: string) =>
  ["", ".1", ".2", ".3", ".4"]
    .filter((suffix) => NodeFS.existsSync(file + suffix))
    .map((suffix) => NodeFS.readFileSync(file + suffix, "utf8"))
    .join("");

const modeOf = (file: string) => NodeFS.statSync(file).mode & 0o777;

it("scrubs tokens and cookies, rotates past its size and keeps three backups, owner-only", () => {
  const file = tempLog();
  const log = makeDesktopLog(file, { maxBytes: 300, maxFiles: 3 });
  log("no service token yet", { error: new Error(`ct0=c0okie, token ${"ab12".repeat(16)}`) });
  log(
    "cookie import rejected",
    "auth_token=authcookie9; Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
  );
  const scrubbed = allLines(file);
  expect(scrubbed).toContain("<redacted>");
  for (const secret of ["ab12ab12", "c0okie", "authcookie9", "eyJhbGci"])
    expect(scrubbed).not.toContain(secret);

  for (let i = 0; i < 20; i++) log("service child exited, restarting", { code: 1, in: i });
  expect(allLines(file)).toContain('{"code":1,"in":19}');
  expect(NodeFS.existsSync(`${file}.3`)).toBe(true);
  expect(NodeFS.existsSync(`${file}.4`)).toBe(false);
  expect(NodeFS.statSync(file).size).toBeLessThanOrEqual(300);
  expect(modeOf(file)).toBe(0o600);
});

it("keeps no draft text, handle, query or path a link or URL carried, only their shape", () => {
  const file = tempLog();
  const log = makeDesktopLog(file);
  log("deep link", {
    url: "xtend://compose?text=PrivateDraftMarker",
    route: "/compose?text=PrivateDraftMarker",
  });
  log("deep link", { url: "xtend://report?handle=PrivateHandle", route: "/u/PrivateHandle" });
  log("response body unavailable", {
    url: "https://x.com/i/api/graphql/AbC123xyz/UserTweets?variables=%7B%22userId%22%3A%22987%22%7D",
    error: "Error: No resource with given identifier found",
  });
  log("refused a webview", {
    src: "https://x.com/i/lists/1234567",
    partition: "persist:x-session-1",
  });
  log("load failed", { url: "https://x.com/messages/111-222" });
  log("no service token yet", { baseDir: "/somewhere/PrivateDir", error: "ENOENT" });
  log("updater", `TypeError: fetch failed for https://x.com/PrivateHandle?x=1 by @PrivateHandle`);
  log("service child did not answer in time", NodePath.join(NodeOS.homedir(), ".xtend"));

  const text = NodeFS.readFileSync(file, "utf8");
  for (const leak of ["PrivateDraftMarker", "PrivateHandle", "variables", "987", "1234567"])
    expect(text).not.toContain(leak);
  for (const leak of ["111-222", "PrivateDir", NodeOS.homedir()]) expect(text).not.toContain(leak);
  for (const shape of [
    '"url":"xtend://compose","route":"/compose"',
    '"route":"/u/:handle"',
    '"url":"https://x.com/i/api/graphql/:hash/UserTweets"',
    '"error":"Error: No resource with given identifier found"',
    '"src":"https://x.com/i/lists/:id","partition":"persist:x-session-1"',
    '"url":"https://x.com/messages/:id"',
    "fetch failed for https://x.com/:handle by @:handle",
    '"~/.xtend"',
  ])
    expect(text).toContain(shape);
});

it("makes an existing world-readable log and its backups owner-only before writing", () => {
  const file = tempLog();
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, "x".repeat(250));
  NodeFS.writeFileSync(`${file}.1`, "old\n");
  NodeFS.chmodSync(file, 0o644);
  NodeFS.chmodSync(`${file}.1`, 0o644);
  const log = makeDesktopLog(file, { maxBytes: 300, maxFiles: 3 });

  log("service child started", { pid: 42 });
  expect([file, `${file}.1`, `${file}.2`].map(modeOf)).toEqual([0o600, 0o600, 0o600]);
});

it("logs a failed load as its page's shape, and skips a load the page replaced", () => {
  const file = tempLog();
  const app = new NodeEvents.EventEmitter();
  const contents = new NodeEvents.EventEmitter();
  logLoadsAndCrashes(app as unknown as Electron.App, makeDesktopLog(file));
  app.emit("web-contents-created", {}, contents);
  contents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://x.com/home", true);
  contents.emit(
    "did-fail-load",
    {},
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://x.com/PrivateHandle/status/123?s=20",
    true,
  );

  const text = NodeFS.readFileSync(file, "utf8");
  expect(text).not.toContain("ERR_ABORTED");
  expect(text).toContain('"url":"https://x.com/:handle/status/:id"');
  expect(text).not.toContain("PrivateHandle");
});

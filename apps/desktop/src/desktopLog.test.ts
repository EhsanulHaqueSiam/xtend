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

it("scrubs tokens and cookies, rotates past its size and keeps three backups, owner-only", () => {
  const file = tempLog();
  const log = makeDesktopLog(file, { maxBytes: 300, maxFiles: 3 });
  log("no service token yet", { serviceToken: "ab12".repeat(16), error: new Error("ct0=c0okie") });
  log("cookie import", "auth_token=authcookie9; Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig");
  const scrubbed = allLines(file);
  expect(scrubbed).toContain("<redacted>");
  for (const secret of ["ab12ab12", "c0okie", "authcookie9", "eyJhbGci"])
    expect(scrubbed).not.toContain(secret);

  for (let i = 0; i < 20; i++) log("service child exited, restarting", { code: 1, attempt: i });
  expect(allLines(file)).toContain('{"code":1,"attempt":19}');
  expect(NodeFS.existsSync(`${file}.3`)).toBe(true);
  expect(NodeFS.existsSync(`${file}.4`)).toBe(false);
  expect(NodeFS.statSync(file).size).toBeLessThanOrEqual(300);
  expect(NodeFS.statSync(file).mode & 0o777).toBe(0o600);
});

it("logs a failed load without its query, and skips a load the page replaced", () => {
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
    "https://x.com/search?q=me",
    true,
  );

  const text = NodeFS.readFileSync(file, "utf8");
  expect(text).not.toContain("ERR_ABORTED");
  expect(text).toContain('"url":"https://x.com/search"');
  expect(text).not.toContain("q=me");
});

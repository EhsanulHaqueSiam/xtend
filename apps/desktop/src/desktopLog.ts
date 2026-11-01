import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { redactText } from "@xtend/contracts";

type Log = (message: string, detail?: unknown) => void;

/** Errors print as their name and message; JSON would make them `{}`. */
const plain = (_key: string, value: unknown) =>
  value instanceof Error ? `${value.name}: ${value.message}` : value;

/** A URL without its query or fragment, and a data: page as just its scheme. */
const pageOf = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith("http")
      ? `${parsed.origin}${parsed.pathname}`
      : parsed.protocol;
  } catch {
    return "";
  }
};

const rotate = (file: string, maxFiles: number) => {
  for (let i = maxFiles - 1; i >= 1; i--)
    if (NodeFS.existsSync(`${file}.${i}`)) NodeFS.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  NodeFS.renameSync(file, `${file}.1`);
};

/**
 * The main process's `log`: each line goes to the launcher's terminal and to `file`
 * (`<baseDir>/logs/desktop.log`), scrubbed like the service's trace file, owner-only, rotated
 * past `maxBytes` to `.1` up to `.<maxFiles>`.
 */
export const makeDesktopLog =
  (file: string, { maxBytes = 5 * 1024 * 1024, maxFiles = 3 } = {}): Log =>
  (message, detail) => {
    const text = detail === undefined ? message : `${message} ${JSON.stringify(detail, plain)}`;
    const line = `${new Date().toISOString()} ${redactText(text)}\n`;
    console.log(`[xtend-desktop] ${line.trimEnd()}`);
    try {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      const size = NodeFS.existsSync(file) ? NodeFS.statSync(file).size : 0;
      if (size > 0 && size + line.length > maxBytes) rotate(file, maxFiles);
      NodeFS.appendFileSync(file, line, { mode: 0o600 });
    } catch (error) {
      // A full disk or a locked file must not take the app down; the terminal still has the line.
      console.log("[xtend-desktop] could not write the desktop log", String(error));
    }
  };

/** Pages that failed to load and helper processes (GPU, network) that died, in every window. */
export const logLoadsAndCrashes = (app: Electron.App, log: Log) => {
  app.on("child-process-gone", (_event, details) =>
    log("child process gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  );
  app.on("web-contents-created", (_event, contents) =>
    contents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
      // -3 is a load the page itself replaced, not a failure.
      if (code !== -3) log("load failed", { url: pageOf(url), code, description, isMainFrame });
    }),
  );
};

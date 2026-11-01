import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { redactText } from "@xtend/contracts";

type Log = (message: string, detail?: unknown) => void;

// First path segments on x.com that are X's own pages; any other first segment is a handle.
const X_PAGES = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "search",
  "i",
  "settings",
  "compose",
  "login",
  "logout",
  "account",
  "bookmarks",
  "hashtag",
]);
const X_HOST = /(^|\.)(x|twitter)\.com$/;

/** A path with ids, handles, GraphQL hashes and hashtags replaced by their names. */
const templatePath = (path: string, onX: boolean) =>
  path
    .split("/")
    .map((segment, i, all) =>
      segment === ""
        ? segment
        : /^\d[\d-]*$/.test(segment)
          ? ":id"
          : all[i - 1] === "graphql"
            ? ":hash"
            : all[i - 1] === "hashtag"
              ? ":tag"
              : (onX && i === 1 && !X_PAGES.has(segment.toLowerCase())) ||
                  (!onX && i === 2 && all[1] === "u")
                ? ":handle"
                : segment,
    )
    .join("/");

/**
 * A URL or app route as its shape: no query or fragment (deep-link text, GraphQL variables,
 * search terms), no handles or ids in the path. Anything but http(s) and xtend: is its scheme.
 */
const templateUrl = (raw: string) => {
  if (raw.startsWith("/")) return templatePath(raw.split(/[?#]/)[0]!, false);
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:")
      return `${url.origin}${templatePath(url.pathname, X_HOST.test(url.hostname))}`;
    if (url.protocol === "xtend:") return `xtend://${url.host}${templatePath(url.pathname, false)}`;
    return url.protocol;
  } catch {
    return "";
  }
};

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;

/** Error text and messages: URLs as their shape, handles and the home path out, credentials scrubbed. */
const freeText = (text: string) =>
  redactText(
    text
      .replace(URL_IN_TEXT, templateUrl)
      .replace(/@\w{1,15}\b/g, "@:handle")
      .replaceAll(NodeOS.homedir(), "~"),
  ).slice(0, 500);

// Strings survive only under these keys; numbers and booleans under any.
const URL_KEYS = new Set(["url", "src", "route"]);
const TEXT_KEYS = new Set([
  "error",
  "reason",
  "type",
  "mode",
  "partition",
  "description",
  "signal",
]);

/** What of a detail is written: allowlisted fields, everything else dropped. */
const allowed = (value: unknown, depth = 0): unknown => {
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "string" || value instanceof Error) return freeText(String(value));
  if (typeof value !== "object" || Array.isArray(value) || depth > 2) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const kept =
      typeof field === "string" || field instanceof Error
        ? URL_KEYS.has(key)
          ? templateUrl(String(field))
          : TEXT_KEYS.has(key)
            ? freeText(String(field))
            : undefined
        : allowed(field, depth + 1);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
};

const rotate = (file: string, maxFiles: number) => {
  for (let i = maxFiles - 1; i >= 1; i--)
    if (NodeFS.existsSync(`${file}.${i}`)) NodeFS.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  NodeFS.renameSync(file, `${file}.1`);
  // Backups an earlier build left world-readable.
  for (let i = 1; i <= maxFiles; i++)
    if (NodeFS.existsSync(`${file}.${i}`)) NodeFS.chmodSync(`${file}.${i}`, 0o600);
};

/**
 * The main process's `log`: each line goes to the launcher's terminal and to `file`
 * (`<baseDir>/logs/desktop.log`), owner-only, rotated past `maxBytes` to `.1` up to
 * `.<maxFiles>`. Only allowlisted detail fields are kept, URLs as their shape, so no draft
 * text, handle, query or credential reaches the disk.
 */
export const makeDesktopLog =
  (file: string, { maxBytes = 5 * 1024 * 1024, maxFiles = 3 } = {}): Log =>
  (message, detail) => {
    const kept = detail === undefined ? undefined : allowed(detail);
    const line = `${new Date().toISOString()} ${freeText(message)}${kept === undefined ? "" : ` ${JSON.stringify(kept)}`}\n`;
    console.log(`[xtend-desktop] ${line.trimEnd()}`);
    try {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      const exists = NodeFS.existsSync(file);
      // A file left 0644 is made owner-only first; if that fails, the line is not written.
      if (exists) NodeFS.chmodSync(file, 0o600);
      const size = exists ? NodeFS.statSync(file).size : 0;
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
      if (code !== -3) log("load failed", { url, code, description, isMainFrame });
    }),
  );
};

// The repo is public: an X session in it hands anyone the account. Fails on profile paths,
// session files, X cookie values, and engine fixtures that were not scrubbed or synthesized.
// The pre-commit hook passes the staged files; with no files it checks every tracked one (CI).

//   node scripts/check-no-x-session.ts [files...]
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Chromium profile directories: what `dev:x-session` copies, and where Electron keeps logins.
const SEGMENTS = new Set([
  "Partitions",
  "x-session",
  ".xtend-dev",
  "Local Storage",
  "IndexedDB",
  "Session Storage",
]);
const FILES = [/^Cookies(-journal)?$/, /\.sqlite/, /\.ldb$/, /^auth-token$/, /^secret-key$/];
const NAMES = "auth_token|ct0|twid|kdt";
const COOKIES: ReadonlyArray<[RegExp, string]> = [
  [/auth_token=[0-9a-f]{40}/, "an X auth_token cookie"],
  [/ct0=[0-9a-f]{32,}/, "an X ct0 cookie"],
  [/twid=u(%3D|=)\d+/, "an X twid cookie"],
  [/kdt=[A-Za-z0-9]{30,}/, "an X kdt cookie"],
  [new RegExp(`"(${NAMES})"\\s*:\\s*"[^"]{12,}"`), "an X session cookie as JSON"],
  // Netscape cookies.txt: domain, subdomains, path, secure, expiry, name, value.
  [
    new RegExp(`^\\S+\\t(TRUE|FALSE)\\t\\S*\\t(TRUE|FALSE)\\t-?\\d+\\t(${NAMES})\\t\\S{8,}`, "m"),
    "an X cookie in cookies.txt form",
  ],
];
// A cookie export's object, whatever order its keys come in.
const exportedCookie = (text: string) =>
  [...text.matchAll(/\{[^{}]*\}/g)].some(
    ([object]) =>
      new RegExp(`"name"\\s*:\\s*"(${NAMES})"`).test(object) &&
      /"value"\s*:\s*"[^"]{12,}"/.test(object),
  );
// treg tokens have no fixed shape (apps/server/src/x/Treg.ts takes any string), so none is matched.

// SQLite (a Cookies database, whatever it is named) and a LevelDB table's footer magic.
const SQLITE = Buffer.from("SQLite format 3\0");
const LEVELDB = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const binaryKind = (bytes: Buffer) =>
  bytes.subarray(0, SQLITE.length).equals(SQLITE)
    ? "a SQLite database"
    : bytes.length >= 8 && bytes.subarray(-8).equals(LEVELDB)
      ? "a LevelDB table"
      : undefined;

const ENGINE_FIXTURES = "apps/web/test/fixtures/engine/";
// scrub and synth (apps/web/src/components/xnative/engineFixtures.ts) count ids up from
// 600000000000..900000000000; X's real post ids are 19-digit snowflakes, user ids anything.
const FAKE_ID = /^[6-9]00000\d{6}$/;
// handleFor's and nameFor's lists; the test runs this on the committed fixtures, so drift fails.
const FIRST = "mira|sam|noor|theo|ines|ravi|lena|kofi|yuki|omar|ada|jonas";
const LAST = "okafor|lind|haddad|brandt|silva|mehta|varga|mensah|sato|farouk|quinn|berg";
const FAKE_HANDLE = new RegExp(`^(you|(${FIRST})_(${LAST})\\d*)$`);
const FAKE_NAME = new RegExp(`^(You|(${FIRST}) (${LAST}))$`, "i");
const FAKE_URL =
  /^(data:|https:\/\/example\.com(\/|$)|https:\/\/t\.co\/s\d+$|https:\/\/x\.com\/search\?)/;

// Fields holding X ids as arrays; any other *Id or *Ids field holds one or more too.
const ID_ARRAYS = new Set(["people", "order", "edits"]);
// Ids scrub replaces with counters (s12, n-3, conv-2, community:s4) or X's own route names.
const OPAQUE_IDS = new Set(["id", "timelineId"]);
const FAKE_OPAQUE = /^(([a-z_]+:)?s\d+|n-\d+|conv-\d+|post-[6-9]00000\d{6}|[a-z_-]+)$/;
// Batch keys and cursors: an id, a search, a handle, or a counter.
const CURSORS = new Set(["key", "top", "bottom", "cursor"]);

/** Why a value under `key` names something real, or undefined. */
function realField(
  key: string,
  value: unknown,
  owner: Record<string, unknown>,
): string | undefined {
  const idField = (/(Id|Ids)$/.test(key) && !OPAQUE_IDS.has(key)) || ID_ARRAYS.has(key);
  // Scrub and synth write every id-like value as a string; a number is X's own.
  if ((idField || OPAQUE_IDS.has(key) || CURSORS.has(key)) && typeof value === "number")
    return `a numeric id ${value} in "${key}"`;
  if (typeof value !== "string") return undefined;
  if (idField && !FAKE_ID.test(value)) return `a real-looking id "${value}" in "${key}"`;
  if (OPAQUE_IDS.has(key) && !FAKE_OPAQUE.test(value))
    return `a real-looking id "${value}" in "${key}"`;
  if (CURSORS.has(key)) {
    if (key === "key" && owner.op === "UserByScreenName")
      return FAKE_HANDLE.test(value) ? undefined : `a real-looking handle @${value}`;
    // A search's query is text, scrubbed as text: its digits are words, not ids.
    const search = /^((top|bottom)-SearchTimeline-)?[A-Za-z]+:/;
    const ids =
      owner.op === "SearchTimeline" && search.test(value) ? value.replace(/:.*$/s, "") : value;
    // Counters (s12) aside, every other number in a key or cursor is an id.
    const id = ids
      .replace(/\bs\d+\b/g, "")
      .match(/\d+/g)
      ?.find((digits) => !FAKE_ID.test(digits));
    if (id !== undefined) return `a real-looking id ${id} in "${key}"`;
  }
  if (typeof value !== "string") return undefined;
  if ((key === "handle" || key === "replyingTo") && !FAKE_HANDLE.test(value))
    return `a real-looking handle @${value}`;
  if (key === "name" && "handle" in owner && !FAKE_NAME.test(value))
    return `a real-looking name "${value}"`;
  if ((/Url$/.test(key) || key === "images") && !value.startsWith("data:"))
    return `a real image ${value.slice(0, 60)} in "${key}"`;
  if (key === "url" && !FAKE_URL.test(value)) return `a real link ${value.slice(0, 60)}`;
  if (key === "open")
    for (const [, h] of value.matchAll(/(?:^\/u\/|[?&]h=)([^/?&]+)/g))
      if (!FAKE_HANDLE.test(h!)) return `a real-looking handle @${h} in "open"`;
  return undefined;
}

/** Walks every field of one fixture line; the first real-looking value, or undefined. */
function realIn(value: unknown, key = "", owner: Record<string, unknown> = {}): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = realIn(item, key, owner);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(object)) {
      const found = realIn(v, k, object);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return realField(key, value, owner);
}

/** Why an engine fixture still holds real data, or undefined when every field is made up. */
function realInFixture(text: string): string | undefined {
  if (text.includes("twimg.com")) return "an image or video from X (twimg.com)";
  // scrub rewrites every link in text to t.co/s<n>; any other slug is a real one.
  const link = /https:\/\/t\.co\/(?!s\d+\b)[A-Za-z0-9]+/.exec(text);
  if (link !== null) return `a real t.co link ${link[0]}`;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return `line ${index + 1} is not JSON, so it cannot be checked`;
    }
    const found = realIn(parsed);
    if (found !== undefined) return `${found} (line ${index + 1})`;
  }
  return undefined;
}

/** Why `file` (repo-relative) must not be committed, or undefined. `read` gives its bytes. */
export function problem(file: string, read: () => Buffer | undefined): string | undefined {
  const parts = file.split(/[\\/]/);
  const segment = parts.slice(0, -1).find((p) => SEGMENTS.has(p));
  if (segment !== undefined) return `inside a "${segment}" directory, part of a browser profile`;
  const name = parts.at(-1)!;
  if (FILES.some((f) => f.test(name))) return `"${name}" is a session or database file`;
  const bytes = read();
  if (bytes === undefined) return undefined;
  const kind = binaryKind(bytes);
  if (kind !== undefined) return `is ${kind}, the format browser profiles keep logins in`;
  // Other binary files (images, fonts) hold no cookie text.
  if (bytes.includes(0)) return undefined;
  const text = bytes.toString("utf8");
  const cookie = COOKIES.find(([pattern]) => pattern.test(text));
  if (cookie !== undefined) return `holds ${cookie[1]}`;
  if (exportedCookie(text)) return "holds an X cookie export";
  if (file.startsWith(ENGINE_FIXTURES)) {
    const real = realInFixture(text);
    if (real !== undefined) return `holds ${real}; run it through \`pnpm engine-fixture scrub\``;
  }
  return undefined;
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const given = process.argv.slice(2);
  const files =
    given.length > 0
      ? given.map((f) => NodePath.relative(root, NodePath.resolve(f)))
      : NodeChildProcess.execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
          .split("\0")
          .filter((f) => f !== "");
  const read = (file: string) => () => {
    try {
      return NodeFS.readFileSync(NodePath.join(root, file));
    } catch {
      // Deleted or a directory (a submodule): nothing to commit.
      return undefined;
    }
  };
  const found = files.flatMap((file) => {
    const why = problem(file, read(file));
    return why === undefined ? [] : [`  ${file}: ${why}`];
  });
  if (found.length > 0) {
    console.error(
      `This repo is public; an X session or real account data in it hands anyone the account:\n${found.join("\n")}`,
    );
    process.exit(1);
  }
}

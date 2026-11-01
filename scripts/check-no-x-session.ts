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
const COOKIES: ReadonlyArray<[RegExp, string]> = [
  [/auth_token=[0-9a-f]{40}/, "an X auth_token cookie"],
  [/ct0=[0-9a-f]{32,}/, "an X ct0 cookie"],
  [/"(auth_token|ct0)"\s*:\s*"[0-9a-f]{32,}"/, "an X session cookie as JSON"],
  [/"name"\s*:\s*"(auth_token|ct0)"[^}]{0,200}"value"\s*:\s*"[0-9a-f]{32,}"/, "an X cookie export"],
];
// treg tokens have no fixed shape (apps/server/src/x/Treg.ts takes any string), so none is matched.

const ENGINE_FIXTURES = "apps/web/test/fixtures/engine/";
// scrub and synth (apps/web/src/components/xnative/engineFixtures.ts) count ids up from
// 600000000000..900000000000; X's real post ids are 19-digit snowflakes, user ids anything.
const FAKE_ID = /^[6-9]00000\d{6}$/;
// handleFor's FIRST and LAST lists; the test runs this on the committed fixtures, so drift fails.
const FAKE_HANDLE =
  /^(you|(mira|sam|noor|theo|ines|ravi|lena|kofi|yuki|omar|ada|jonas)_(okafor|lind|haddad|brandt|silva|mehta|varga|mensah|sato|farouk|quinn|berg)\d*)$/;

/** Why an engine fixture still holds real data, or undefined when every id, handle and link is made up. */
function realInFixture(text: string): string | undefined {
  for (const [, digits] of text.matchAll(/"(?:[a-z]+[:-])?(\d{5,})(?=[":])/g))
    if (!FAKE_ID.test(digits!)) return `a real-looking id ${digits}`;
  const handles = [
    ...[...text.matchAll(/"handle":"([^"]*)"/g)].map((m) => m[1]!),
    ...[...text.matchAll(/"replyingTo":\[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1]!.matchAll(/"([^"]*)"/g)].map((h) => h[1]!),
    ),
  ];
  const handle = handles.find((h) => !FAKE_HANDLE.test(h));
  if (handle !== undefined) return `a real-looking handle @${handle}`;
  if (text.includes("twimg.com")) return "an image or video from X (twimg.com)";
  const link = /https:\/\/t\.co\/(?!s\d+["\\])[A-Za-z0-9]+/.exec(text);
  if (link !== null) return `a real t.co link ${link[0]}`;
  return undefined;
}

/** Why `file` (repo-relative) must not be committed, or undefined. */
export function problem(file: string, read: () => string | undefined): string | undefined {
  const parts = file.split(/[\\/]/);
  const segment = parts.slice(0, -1).find((p) => SEGMENTS.has(p));
  if (segment !== undefined) return `inside a "${segment}" directory, part of a browser profile`;
  const name = parts.at(-1)!;
  if (FILES.some((f) => f.test(name))) return `"${name}" is a session or database file`;
  const text = read();
  if (text === undefined) return undefined;
  const cookie = COOKIES.find(([pattern]) => pattern.test(text));
  if (cookie !== undefined) return `holds ${cookie[1]}`;
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
      const bytes = NodeFS.readFileSync(NodePath.join(root, file));
      // Binary files are judged by their names; cookie values are text.
      return bytes.includes(0) ? undefined : bytes.toString("utf8");
    } catch {
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

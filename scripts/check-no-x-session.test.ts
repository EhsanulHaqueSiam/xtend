import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import {
  formatFixture,
  parseFixture,
  scrub,
} from "../apps/web/src/components/xnative/engineFixtures.ts";
import { problem } from "./check-no-x-session.ts";

const text = (body: string | Buffer) => () => Buffer.from(body);
const hex = (n: number) => "0123456789abcdef".repeat(4).slice(0, n);

it("rejects browser profile directories and session files by path", () => {
  for (const file of [
    ".xtend/electron/Partitions/x-session/Preferences",
    "x-session/Preferences",
    ".xtend-dev/notes.txt",
    "profile/Local Storage/leveldb/000003.log",
    "profile/IndexedDB/https_x.com_0.indexeddb.leveldb/LOG",
    "profile/Session Storage/MANIFEST-000001",
    "copy/Cookies",
    "copy/Cookies-journal",
    "home/xtend.sqlite",
    "home/xtend.sqlite-wal",
    "store/000005.ldb",
    "home/auth-token",
    "home/secret-key",
  ])
    expect(problem(file, text("")), file).toBeDefined();
  for (const file of [
    "scripts/dev-x-session.ts",
    "docs/operations/development.md",
    "apps/server/src/x/Treg.ts",
    "apps/web/src/cookies.ts",
  ])
    expect(problem(file, text("")), file).toBeUndefined();
});

it("rejects X session cookie values in any text file", () => {
  for (const body of [
    `document.cookie = "auth_token=${hex(40)}"`,
    `ct0=${hex(64)}; Path=/`,
    `{"auth_token": "${hex(40)}"}`,
    `[{"name": "ct0", "domain": ".x.com", "value": "${hex(32)}"}]`,
    // An export with the value first, and the cookies that sit beside auth_token.
    `[{"value": "${hex(40)}", "domain": ".x.com", "name": "auth_token"}]`,
    `Cookie: twid=u%3D${"1".repeat(19)}`,
    `{"kdt": "${"Ab3".repeat(14)}"}`,
    // Netscape cookies.txt, as browser extensions and yt-dlp write it.
    `.x.com\tTRUE\t/\tTRUE\t1830000000\tauth_token\t${hex(40)}`,
  ])
    expect(problem("notes.md", text(body)), body).toMatch(/cookie/);
  // The names alone, and values too short or not hex, are how code and docs talk about them.
  for (const body of [
    "SELECT expires_utc FROM cookies WHERE name = 'auth_token'",
    "auth_token=<the value>",
    `ct0=${hex(16)}`,
    `{"name": "ct0", "value": "dev"}`,
    `{"value": "a long value of a cookie nobody cares about", "name": "theme"}`,
    `.x.com\tTRUE\t/\tTRUE\t1830000000\tlang\ten`,
  ])
    expect(problem("notes.md", text(body)), body).toBeUndefined();
});

it("rejects a browser database or LevelDB table under any name", () => {
  const sqlite = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(100)]);
  expect(problem("snapshot.dat", text(sqlite))).toMatch(/SQLite/);
  const table = Buffer.concat([
    Buffer.alloc(64, 1),
    Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]),
  ]);
  expect(problem("blob.bin", text(table))).toMatch(/LevelDB/);
  // Other binary files (a PNG) are judged by name only.
  expect(problem("shot.png", text(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])))).toBe(
    undefined,
  );
});

/** `text`'s NDJSON with the first non-null `field` set to `value`; undefined when none has it. */
const plant = (text: string, field: string, value: unknown) => {
  let done = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v === null || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => {
        if (!done && k === field && x !== null) {
          done = true;
          return [k, value];
        }
        return [k, walk(x)];
      }),
    );
  };
  const out = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.stringify(walk(JSON.parse(line))))
    .join("\n");
  return done ? out : undefined;
};

it("passes the committed engine fixtures and fails one that was not scrubbed", () => {
  const dir = NodePath.join(import.meta.dirname, "../apps/web/test/fixtures/engine");
  for (const name of NodeFS.readdirSync(dir)) {
    const file = `apps/web/test/fixtures/engine/${name}`;
    expect(problem(file, text(NodeFS.readFileSync(NodePath.join(dir, name), "utf8"))), name).toBe(
      undefined,
    );
  }
  const recorded = "apps/web/test/fixtures/engine/recorded.ndjson";
  const line = (post: string) =>
    `{"op":"HomeLatestTimeline","key":null,"posts":[${post}],"users":[]}`;
  const fake = `{"postId":"900000000001","author":{"userId":"900000000002","handle":"mira_brandt","name":"Mira Brandt","avatarUrl":"data:image/svg+xml,x"},"replyingTo":["theo_varga51"],"text":"https://t.co/s12"}`;
  expect(problem(recorded, text(line(fake)))).toBeUndefined();
  for (const [real, why] of [
    [fake.replace("900000000001", "1985123456789012345"), /id "1985123456789012345"/],
    [fake.replace("900000000002", "44196397"), /id "44196397"/],
    [fake.replace('"handle":"mira_brandt"', '"handle":"elonmusk"'), /@elonmusk/],
    [fake.replace('["theo_varga51"]', '["jack"]'), /@jack/],
    [fake.replace("data:image/svg+xml,x", "https://pbs.twimg.com/profile_images/1/a.jpg"), /twimg/],
    [fake.replace("https://t.co/s12", "https://t.co/AbC12xYz9"), /t\.co/],
    // Spacing and key order change nothing, and an id as a number is refused.
    [fake.replace('"postId":"900000000001"', '"postId" : "1985123456789012345"'), /id "1985/],
    [fake.replace('"postId":"900000000001"', '"postId":1985123456789012345'), /numeric id/],
    [fake.replace('"name":"Mira Brandt"', '"name":"Elon Musk"'), /name "Elon Musk"/],
    [fake.replace('"text":"https://t.co/s12"', '"url":"https://x.com/elonmusk"'), /real link/],
    [`{"open":["/u/elonmusk"]}`, /@elonmusk/],
    ["not json", /not JSON/],
  ] as const)
    expect(
      problem(recorded, text(real.startsWith('{"open') || real === "not json" ? real : line(real))),
      real,
    ).toMatch(why);
  // Each field that holds an id, in the committed fixtures, with a real-looking id put in.
  const committed = NodeFS.readdirSync(dir)
    .map((name) => NodeFS.readFileSync(NodePath.join(dir, name), "utf8"))
    .join("\n");
  for (const [field, real] of [
    ["postId", "1234"],
    ["userId", "44196397"],
    ["quotedId", "1985123456789012345"],
    ["replyToId", "1985123456789012345"],
    ["listId", "1234567"],
    ["pinnedPostId", 1985123456789],
    ["people", ["44196397"]],
    ["order", ["1985123456789012345"]],
    ["order", ["who-to-follow-1985123456789012345"]],
    ["edits", ["1234"]],
    ["postIds", ["1985123456789012345"]],
    ["id", "1985123456789012345"],
    ["id", "who-to-follow-1985123456789012345"],
    ["timelineId", "1985123456789012345"],
    ["key", "list:1234"],
    ["top", "top-ListByRestId-list:1985123456789012345"],
    // A number is never a scrubbed form, whatever field holds it.
    ["id", 44196397],
    ["timelineId", 44196397],
    ["key", 44196397],
    ["top", 44196397],
    ["bottom", 44196397],
    ["cursor", 44196397],
  ] as const) {
    expect(plant(committed, field, real), field).toBeDefined();
    expect(problem(recorded, text(plant(committed, field, real)!)), field).toMatch(/id/);
  }
  // The id rule is for engine fixtures only; elsewhere long numbers are ordinary.
  expect(
    problem(
      "apps/server/test/x.json",
      text(line(fake.replace("900000000001", "1985123456789012345"))),
    ),
  ).toBeUndefined();
});

it("reads a search query as text, except where it names an account or a post", () => {
  const search = (query: string, field: "key" | "top" = "key") =>
    problem(
      "apps/web/test/fixtures/engine/search.ndjson",
      text(
        JSON.stringify({
          op: "SearchTimeline",
          [field]: field === "key" ? `Top:${query}` : `top-SearchTimeline-Top:${query}`,
        }),
      ),
    );
  for (const query of [
    "from:44196397",
    "to:12 launch",
    "@44196397 thanks",
    "(@4419639)",
    '"@4419639"',
    "launch,@4419639",
    "(from:me OR @12)",
    "conversation_id:1985123456789012345",
    "quoted_tweet_id:1985123456789",
    "list:1234567",
    "url:1985123456789012345",
    "https://x.com/example/status/1985123456789012345",
    "twitter.com/i/user/12",
    "1985123456789",
  ]) {
    expect(search(query), query).toMatch(/search query/);
    expect(search(query, "top"), `top ${query}`).toMatch(/search query/);
  }
  for (const query of [
    "2026 roadmap",
    "top 10 tools",
    "from:mira_brandt",
    "since:2026-01-01",
    "mail me at team@2026",
    "100k followers 1234567",
  ])
    expect(search(query), query).toBeUndefined();
});

it("passes whatever scrub makes of a recording, numbers in search queries included", () => {
  const dir = NodePath.join(import.meta.dirname, "../apps/web/test/fixtures/engine");
  const { meta, batches } = parseFixture(
    NodeFS.readFileSync(NodePath.join(dir, "search.ndjson"), "utf8"),
  );
  const recording = batches.map((b) =>
    b.op === "SearchTimeline"
      ? { ...b, key: "Top:2026 roadmap 42", top: "top-SearchTimeline-Top:2026 roadmap 42" }
      : b,
  );
  const scrubbed = scrub(recording);
  // Digits stay digits through scrub's word swap, so the case is exercised.
  expect(scrubbed.find((b) => b.op === "SearchTimeline")?.key).toMatch(/^Top:\d+ \S+ \d+$/);
  const file = formatFixture({ meta, batches: scrubbed });
  expect(problem("apps/web/test/fixtures/engine/scrubbed.ndjson", text(file))).toBeUndefined();
  // And twice over.
  const twice = formatFixture({ meta, batches: scrub(scrubbed) });
  expect(problem("apps/web/test/fixtures/engine/scrubbed.ndjson", text(twice))).toBeUndefined();
});

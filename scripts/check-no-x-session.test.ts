import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect, it } from "vite-plus/test";

import { problem } from "./check-no-x-session.ts";

const text = (body: string) => () => body;
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
  ])
    expect(problem("notes.md", text(body)), body).toMatch(/cookie/);
  // The names alone, and values too short or not hex, are how code and docs talk about them.
  for (const body of [
    "SELECT expires_utc FROM cookies WHERE name = 'auth_token'",
    "auth_token=<the value>",
    `ct0=${hex(16)}`,
    `{"name": "ct0", "value": "dev"}`,
  ])
    expect(problem("notes.md", text(body)), body).toBeUndefined();
});

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
  const fake = `{"postId":"900000000001","author":{"userId":"900000000002","handle":"mira_brandt","avatarUrl":"data:image/svg+xml,x"},"replyingTo":["theo_varga51"],"text":"https://t.co/s12"}`;
  expect(problem(recorded, text(line(fake)))).toBeUndefined();
  for (const [real, why] of [
    [fake.replace("900000000001", "1985123456789012345"), /id 1985123456789012345/],
    [fake.replace("900000000002", "44196397"), /id 44196397/],
    [fake.replace('"handle":"mira_brandt"', '"handle":"elonmusk"'), /@elonmusk/],
    [fake.replace('["theo_varga51"]', '["jack"]'), /@jack/],
    [fake.replace("data:image/svg+xml,x", "https://pbs.twimg.com/profile_images/1/a.jpg"), /twimg/],
    [fake.replace("https://t.co/s12", "https://t.co/AbC12xYz9"), /t\.co/],
  ] as const)
    expect(problem(recorded, text(line(real)))).toMatch(why);
  // The id rule is for engine fixtures only; elsewhere long numbers are ordinary.
  expect(
    problem(
      "apps/server/test/x.json",
      text(line(fake.replace("900000000001", "1985123456789012345"))),
    ),
  ).toBeUndefined();
});

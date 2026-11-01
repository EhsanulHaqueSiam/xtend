// Writes the engine fixtures dev replays into the web app (apps/web/test/fixtures/engine): the
// made-up set, or a recording scrubbed of every id, handle, name, word, image and link. A raw
// recording is the real account's data: keep it outside the repo, commit only the scrubbed file.

//   node scripts/engine-fixture.ts synth                         every made-up fixture
//   node scripts/engine-fixture.ts scrub <recording.ndjson> <name> ["what it shows"]
//   (record with apps/desktop/scripts/cdp.mjs record / dump)
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { EngineBatch } from "@xtend/contracts";

import { formatFixture, scrub, synth } from "../apps/web/src/components/xnative/engineFixtures.ts";

const DIR = NodePath.join(import.meta.dirname, "../apps/web/test/fixtures/engine");
const write = (name: string, body: string) => {
  NodeFS.mkdirSync(DIR, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(DIR, `${name}.ndjson`), body);
  console.log(
    `engine-fixture: wrote ${NodePath.relative(process.cwd(), NodePath.join(DIR, `${name}.ndjson`))}`,
  );
};

/** The native screens a recording's responses fill, for the fixture's meta line. */
const pagesOf = (batches: ReadonlyArray<EngineBatch>) => [
  ...new Set(
    batches.flatMap((b): ReadonlyArray<string> => {
      const author = b.posts.find((p) => p.postId === b.key)?.author.handle ?? "i";
      if (b.op === "HomeLatestTimeline") return ["/home?feed=following"];
      if (b.op === "HomeTimeline" && b.key === null) return ["/home?feed=forYou"];
      if (b.op === "TweetDetail" && b.key !== null)
        return [`/post/${b.key.split(":")[0]}?h=${author}`];
      if (b.op === "UserByScreenName" && b.key !== null) return [`/u/${b.key}`];
      if (b.op === "NotificationsTimeline") return ["/notifications"];
      if (b.op === "Bookmarks") return ["/bookmarks"];
      if (b.op === "ExplorePage") return ["/explore"];
      if (b.op === "ListsManagementPageTimeline") return ["/lists"];
      if (b.op === "ConnectTabTimeline")
        return [b.key === "connect:creators" ? "/follow?tab=creators" : "/follow"];
      if (b.op === "ListLatestTweetsTimeline" && b.key !== null)
        return [`/lists/${b.key.slice(5)}`];
      if (b.op === "SearchTimeline" && b.key !== null) {
        const at = b.key.indexOf(":");
        return [
          `/search?q=${encodeURIComponent(b.key.slice(at + 1))}&f=${b.key.slice(0, at).toLowerCase()}`,
        ];
      }
      return [];
    }),
  ),
];

const [command, input, name, description] = process.argv.slice(2);
if (command === "synth") {
  for (const [fixtureName, fixture] of Object.entries(synth()))
    write(fixtureName, formatFixture(fixture));
} else if (
  command === "scrub" &&
  input !== undefined &&
  name !== undefined &&
  /^[a-z0-9-]+$/.test(name)
) {
  const batches = NodeFS.readFileSync(input, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as EngineBatch)
    .filter((b) => typeof b.op === "string");
  const clean = scrub(batches);
  const times = clean.flatMap((b) => b.posts.map((p) => Date.parse(p.createdAt)));
  write(
    name,
    formatFixture({
      meta: {
        fixture: name,
        description: description ?? `Recorded: ${[...new Set(clean.map((b) => b.op))].join(", ")}`,
        at: new Date(times.length === 0 ? Date.now() : Math.max(...times)).toISOString(),
        open: pagesOf(clean),
      },
      batches: clean,
    }),
  );
} else {
  console.error(
    "usage: node scripts/engine-fixture.ts synth | scrub <recording.ndjson> <name> [description]",
  );
  process.exit(2);
}

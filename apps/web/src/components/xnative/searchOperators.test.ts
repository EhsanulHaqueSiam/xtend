import { expect, it } from "vite-plus/test";

import { type AdvancedSearch, EMPTY_SEARCH, readQuery, writeQuery } from "./searchOperators";

const form = (fields: Partial<AdvancedSearch>): AdvancedSearch => ({ ...EMPTY_SEARCH, ...fields });

it("writes every field as X's operator and reads the query back into the same form", () => {
  const cases: ReadonlyArray<readonly [AdvancedSearch, string]> = [
    [EMPTY_SEARCH, ""],
    [
      form({
        all: "US stocks",
        phrase: "happy hour",
        any: "cats dogs",
        none: "crypto nft",
        hashtags: "ThrowbackThursday #tbt",
        lang: "en",
        from: "@alice bob",
        to: "carol",
        mentioning: "SFBART,Caltrain",
        replies: "exclude",
        links: "only",
        minReplies: "280",
        minLikes: "20",
        minReposts: "5",
        since: "2026-01-01",
        until: "2026-10-31",
      }),
      'US stocks "happy hour" (cats OR dogs) -crypto -nft (#ThrowbackThursday OR #tbt) (from:alice OR from:bob) to:carol (@SFBART OR @Caltrain) min_replies:280 min_faves:20 min_retweets:5 lang:en until:2026-10-31 since:2026-01-01 -filter:replies filter:links',
    ],
    [form({ replies: "only", links: "exclude" }), "filter:replies -filter:links"],
    [form({ any: 'cats "hot dogs"', none: '"bad take"' }), '(cats OR "hot dogs") -"bad take"'],
    // Operators the form has no field for stay as typed in "All of these words".
    [
      form({ all: "filter:media near:Paris", minLikes: "100" }),
      "filter:media near:Paris min_faves:100",
    ],
  ];
  for (const [fields, query] of cases) {
    expect(writeQuery(fields)).toBe(query);
    expect(readQuery(query)).toEqual(
      // Handles and hashtags read back as X writes them, without @ or # and space separated.
      {
        ...fields,
        hashtags: fields.hashtags.replace(/#/g, ""),
        from: fields.from.replace(/@/g, ""),
        mentioning: fields.mentioning.replace(/,/g, " "),
      },
    );
  }
});

it("never lets a typed quote, dash or zero change what X searches", () => {
  // X has no escape inside a phrase, and an unclosed quote would swallow every operator after it.
  expect(writeQuery(form({ phrase: 'say "hi" now', all: 'don"t', minReplies: "007" }))).toBe(
    'dont "say hi now" min_replies:7',
  );
  expect(writeQuery(form({ none: "--spam -", minLikes: "0", lang: "" }))).toBe("-spam");
  expect(writeQuery(form({ since: "2026-1-1" }))).toBe("");
});

it("keeps every term of a query the form cannot hold", () => {
  // Repeats mean every one (both authors, both tags), not either, so they stay as typed.
  const queries = [
    "from:a from:b",
    "#one #two lang:xx",
    '"first phrase" "second phrase"',
    "(from:a OR @b) cats",
    "filter:replies -filter:replies",
    "until:yesterday since:2026-01-01",
  ];
  const sorted = (query: string) => query.split(" ").sort();
  for (const query of queries) expect(sorted(writeQuery(readQuery(query)))).toEqual(sorted(query));
  expect(readQuery("from:a from:b")).toMatchObject({ from: "a", all: "from:b" });
});

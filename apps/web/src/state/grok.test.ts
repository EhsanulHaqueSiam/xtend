import { expect, it } from "vite-plus/test";

import { type GrokAnswer, namedHandles } from "./grok";

const run = (text: string, href: string | null = null) => ({
  text,
  bold: false,
  italic: false,
  code: false,
  href,
});

it("names each person an answer points at once, by X's profile links and @handles, never X's own pages", () => {
  const answer: GrokAnswer = {
    id: "r1",
    trace: null,
    sources: null,
    done: true,
    feedback: null,
    regenerate: false,
    blocks: [
      { kind: "p", runs: [run("@JonPark", "https://x.com/JonPark"), run(" and @lenaw argue.")] },
      {
        kind: "li",
        ordered: false,
        depth: 0,
        runs: [run("See x.com/i/grok, mail a@b.co, @jonpark again")],
      },
      { kind: "table", head: false, rows: [[[run("Maya", "https://x.com/mayabuilds")]]] },
      {
        kind: "p",
        runs: [run("Home", "https://x.com/home"), run("post", "https://x.com/dev/status/1")],
      },
    ],
  };
  expect(namedHandles(answer)).toEqual(["JonPark", "lenaw", "mayabuilds"]);
});

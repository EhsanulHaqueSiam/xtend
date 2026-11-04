import { expect, it } from "vite-plus/test";

import { type GrokAnswer, namedHandles, sendSettled } from "./grok";

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

const turn = (id: string, user: string) => ({ id, user, answer: null });
const page = (
  path: string,
  turns: ReadonlyArray<ReturnType<typeof turn>>,
  alert: string | null = null,
) =>
  ({
    path,
    page: "xweb",
    turns,
    followUps: [],
    alert,
    composer: null,
    model: null,
    private: null,
    conversation: true,
  }) as const;

it("settles a send only by a new turn on its own page, and ends it when X refuses it", () => {
  const write = {
    draft: "Again?",
    send: { text: "Again?", path: "/i/grok/c/a", before: ["t1"], alert: null },
  };
  // The same question asked before is not this send.
  expect(sendSettled(write, page("/i/grok/c/a", [turn("t1", "Again?")]))).toBeNull();
  expect(
    sendSettled(write, page("/i/grok/c/a", [turn("t1", "Again?"), turn("t2", "Again?")])),
  ).toBe("shown");
  // X refused it: another page, another conversation (New chat), or X's alert.
  expect(sendSettled(write, page("/i/grok/c/b", [turn("t2", "Again?")]))).toBe("failed");
  expect(sendSettled(write, page("/i/grok/c/a", []))).toBe("failed");
  expect(
    sendSettled(write, page("/i/grok/c/a", [turn("t1", "Again?")], "Grok lost its connection.")),
  ).toBe("failed");
  // An alert X already showed when the user sent is not X's answer to this send.
  const shown = { ...write, send: { ...write.send, alert: "Grok lost its connection." } };
  expect(
    sendSettled(shown, page("/i/grok/c/a", [turn("t1", "Again?")], "Grok lost its connection.")),
  ).toBeNull();
});

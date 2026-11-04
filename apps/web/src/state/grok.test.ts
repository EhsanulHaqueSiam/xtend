import { expect, it } from "vite-plus/test";

import { type GrokAnswer, namedHandles, settleSend } from "./grok";

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
  chat: string | null = path.startsWith("/i/grok/c/") ? path.slice(10) : null,
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
    chat,
  }) as const;
const sending = (send: { before: Array<string>; alert?: string; chat?: string | null }) => ({
  draft: "Again?",
  send: {
    id: 1,
    text: "Again?",
    path: "/i/grok",
    chat: send.chat === undefined ? "a" : send.chat,
    before: send.before,
    alert: send.alert ?? null,
  },
});
const sent = { draft: "", send: null };
const kept = { draft: "Again?", send: null };

it("settles a send only by its own conversation grown by its question, and ends it when X refuses it", () => {
  const write = sending({ before: ["t1"] });
  // The same question asked before is not this send.
  expect(settleSend(write, page("/i/grok", [turn("t1", "Again?")], null, "a"))).toBe(write);
  expect(
    settleSend(write, page("/i/grok", [turn("t1", "Again?"), turn("t2", "Again?")], null, "a")),
  ).toEqual(sent);
  // Another conversation that holds the same question is not this send's: X moved on.
  expect(
    settleSend(write, page("/i/grok", [turn("t1", "Again?"), turn("b2", "Again?")], null, "b")),
  ).toEqual(kept);
  expect(settleSend(write, page("/i/grok/c/b", [turn("t2", "Again?")]))).toEqual(kept);
  expect(settleSend(write, page("/i/grok", [], null, "a"))).toEqual(kept);
  // A new chat's first question, once X gives the chat its id.
  expect(
    settleSend(
      sending({ before: [], chat: null }),
      page("/i/grok", [turn("n1", "Again?")], null, "new"),
    ),
  ).toEqual(sent);
});

it("ends a send on X's alert during its attempt, even one X showed before it and cleared", () => {
  const lost = "Grok lost its connection. Please try again.";
  const retry = sending({ before: ["t1"], alert: lost });
  const at = (alert: string | null) => page("/i/grok", [turn("t1", "Again?")], alert, "a");
  // Still the alert X showed when the user sent again: not X's answer to this attempt.
  expect(settleSend(retry, at(lost))).toBe(retry);
  // X clears it, then shows it again: this attempt failed.
  const cleared = settleSend(retry, at(null));
  expect(cleared.send?.alert).toBeNull();
  expect(settleSend(cleared, at(lost))).toEqual(kept);
});

import { describe, expect, it } from "vite-plus/test";
import { grade } from "./grade.ts";

const good = {
  read: "Proud announcement",
  signals: ["States a before and after number"],
  why: "The author shared a concrete result.",
  angles: [
    { label: "Answer with your number", text: "Ours went 14 to 4 with the same trick." },
    {
      label: "Push back on the premise",
      text: "Caching hides a slow install, it does not fix it.",
    },
    { label: "Ask the sharp question", text: "How often does the hash miss in a normal week?" },
  ],
};
const topReplies = ["Which CI? GitHub Actions caps the cache at 10GB and that bit us hard."];
const angle = (text: string, label = "Add a fact") => ({
  ...good,
  angles: [...good.angles.slice(0, 2), { label, text }],
});

describe("grade", () => {
  it("passes a read that keeps every promise", () => {
    expect(grade(good, { topReplies })).toEqual({ pass: true, failures: [] });
  });

  it.each([
    ["too few angles", { ...good, angles: good.angles.slice(0, 2) }, "2 angles"],
    ["a long read", { ...good, read: "A very proud product announcement" }, "read is 5 words"],
    ["over 280 characters", angle("a".repeat(281)), "angle 3 is 281 characters"],
    ["a hashtag", angle("Same here #buildinpublic"), "angle 3 has a hashtag"],
    ["an em dash", angle("Same here — ours too."), "angle 3 has an em dash"],
    ["flattery", angle("Great post, ours did the same."), "angle 3 opens with flattery"],
    ["a mood label", angle("Ours did not.", "Witty"), 'angle 3 label "Witty" is a mood word'],
    [
      "a shared opening",
      angle("Ours went 14 minutes faster."),
      'angle 3 repeats the opening "ours went 14"',
    ],
    [
      "a copied top reply",
      angle("Which CI? GitHub Actions caps the cache at 10GB, that bit us."),
      "angle 3 repeats a top reply",
    ],
  ])("fails %s", (_name, read, failure) => {
    expect(grade(read, { topReplies }).failures).toContain(failure);
  });

  it("holds a case to its own read and angle checks", () => {
    const expectJapanese = { everyAngle: /\p{Script=Hiragana}/u, read: /sarcas/i };
    expect(grade(good, { topReplies: [], expect: expectJapanese }).failures).toEqual([
      "angle 1 does not match /\\p{Script=Hiragana}/u",
      "angle 2 does not match /\\p{Script=Hiragana}/u",
      "angle 3 does not match /\\p{Script=Hiragana}/u",
      'read "Proud announcement" does not match /sarcas/i',
    ]);
  });
});

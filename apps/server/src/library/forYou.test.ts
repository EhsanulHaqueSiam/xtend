import { describe, expect, it } from "@effect/vitest";
import type { ObservedPostSummary } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";

import { interests, rankTopics, terms } from "./forYou.ts";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const hoursBefore = (h: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - h * 3_600_000));

const seen = (handle: string, text: string, hoursAgo = 1): ObservedPostSummary => ({
  postId: `${handle}-${text.length}-${hoursAgo}`,
  author: { userId: handle, handle, name: handle, followers: 100, verified: false },
  text,
  createdAt: hoursBefore(hoursAgo),
  isReply: false,
  isRepost: false,
  isPromoted: false,
  hasMedia: false,
  hasLink: false,
  metrics: { views: 0, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  firstSeenAt: hoursBefore(0),
  lastSeenAt: hoursBefore(0),
  observations: 1,
});

const profile = interests({
  keywords: ["pricing"],
  ownTexts: ["Pricing pages lie", "Onboarding emails that convert"],
  savedTexts: [],
  closeHandles: [],
});

describe("terms", () => {
  it("keeps words, hashtags, capitalised acronyms and word pairs, not links, handles or filler", () => {
    expect(terms("@ann The AI pricing #saas is wild https://x.co/a")).toEqual([
      "ai",
      "ai pricing",
      "pricing",
      "#saas",
      "wild",
    ]);
    // A common word is no topic alone, but it makes one with its neighbour.
    expect(terms("Local first is the best")).toEqual(["local", "local first"]);
  });
});

describe("rankTopics", () => {
  it("ranks feed topics that touch the profile, says why, and keeps one outside slot", () => {
    const topics = rankTopics({
      profile,
      feed: [
        seen("ann", "Usage pricing is back"),
        seen("bob", "Why usage pricing wins"),
        seen("cat", "Football tonight"),
        seen("dan", "Football again"),
        seen("eve", "Football final"),
        seen("me", "Usage pricing thread"),
        seen("old", "Usage pricing", 30),
      ],
      rising: [
        { word: "onboarding", today: 40, perDayBefore: 10, lift: 4 },
        { word: "election", today: 90, perDayBefore: 10, lift: 9 },
      ],
      self: "me",
      nowMs: NOW,
    });
    expect(topics.map((t) => [t.term, t.source])).toEqual([
      ["usage pricing", "feed"],
      ["onboarding", "pool"],
      ["election", "outside"],
    ]);
    expect(topics[0]?.reason).toBe(
      "2 accounts in your feed today · in your keywords · you post about it",
    );
    expect(topics[1]?.reason).toBe("rising across Xtend, 4.0× last week · you post about it");
  });
});

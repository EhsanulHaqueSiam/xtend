import { describe, expect, it } from "@effect/vitest";
import type { XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Assist from "../ai/Assist.ts";
import * as DraftStore from "../compose/DraftStore.ts";
import * as EngageStore from "../engage/EngageStore.ts";
import * as Events from "../events/Events.ts";
import * as Library from "../library/Library.ts";
import * as LibraryStore from "../library/LibraryStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as XClient from "../x/XClient.ts";
import * as Costs from "./Costs.ts";

/** Whether the connected account's id is in the read cache. */
let meWarm = false;
/** The mentions pages in the read cache, by the `since_id` they asked for ("" for none). */
let mentionsWarm: ReadonlyArray<string> = [];

const layerTest = Costs.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(SettingsStore.layer, EngageStore.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        cached: {
          // Only the first top-mode page of "warm" is cached.
          search: (query, mode, cursor) =>
            Effect.succeed(query === "warm" && mode !== "latest" && cursor === undefined),
          profile: (handle) => Effect.succeed(handle === "warm"),
          userPosts: () => Effect.succeed(false),
          // The 12-hour copy a score run reads is warm; a new-follower check wants a fresher one.
          followers: (_handle, fresh) => Effect.succeed(fresh !== true),
          trending: () => Effect.succeed(true),
          me: Effect.sync(() => meWarm),
          mentions: (sinceId) => Effect.sync(() => mentionsWarm.includes(sinceId ?? "")),
        },
      }),
    ),
  ),
);

// Costs and Library over one database, so the quote reads the same pick_fetches the fetch writes.
let searches = 0;
const layerPicks = Layer.mergeAll(Costs.layer, Library.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(LibraryStore.layer, DraftStore.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      SettingsStore.layer,
      Events.layer,
      Layer.succeed(Assist.Assist)({ generate: () => Effect.die("no model in this test") }),
    ),
  ),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        searchPosts: () =>
          Effect.sync(() => {
            searches += 1;
            return { items: [], nextCursor: null, fromCache: false };
          }),
      }),
    ),
  ),
);

const mentionPost = (postId: string): XPost => ({
  postId,
  url: `https://x.com/ann/status/${postId}`,
  text: "@siam hi",
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: null,
  isReply: true,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: {
    userId: "2",
    handle: "ann",
    name: "Ann",
    followers: 1,
    verified: false,
    avatarUrl: null,
  },
  metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

describe("Costs", () => {
  it.effect("quotes from the one rate card and marks cached reads free", () =>
    Effect.gen(function* () {
      const costs = yield* Costs.Costs;
      const { rates, quotes } = yield* costs.quote([
        { kind: "post", text: "plain" },
        { kind: "post", text: "see https://x.com" },
        { kind: "search", query: "cold" },
        { kind: "search", query: "warm" },
        { kind: "search", query: "warm", mode: "latest" },
        // The next page of a cached search is a read of its own.
        { kind: "search", query: "warm", cursor: "page-2" },
        { kind: "trending", country: "UnitedStates" },
        { kind: "scoreRun", handle: "levelsio" },
        { kind: "scoreRun", handle: "warm" },
        { kind: "followersPage", handle: "levelsio" },
      ]);
      expect(rates).toEqual(XClient.RATE_CARD);
      expect(quotes.map((q) => q.usd)).toEqual([
        rates.post,
        rates.postWithLink,
        rates.searchPage,
        0,
        rates.searchPage,
        rates.searchPage,
        0,
        // A warm profile and first page are free; the four pages after them cannot be probed.
        rates.scraperProfile + 4 * rates.followersPage,
        4 * rates.followersPage,
        rates.followersPage,
      ]);
      expect(quotes.map((q) => q.cached)).toEqual([
        false,
        false,
        false,
        true,
        false,
        false,
        true,
        false,
        false,
        false,
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("adds the daily account lookup to like and mentions quotes until it is cached", () =>
    Effect.gen(function* () {
      const costs = yield* Costs.Costs;
      const rates = XClient.RATE_CARD;
      const usd = Effect.map(costs.quote([{ kind: "like" }, { kind: "mentions" }]), (r) =>
        r.quotes.map((q) => q.usd),
      );
      meWarm = false;
      expect(yield* usd).toEqual([rates.like + rates.profile, rates.readPage + rates.profile]);
      meWarm = true;
      expect(yield* usd).toEqual([rates.like, rates.readPage]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("prices the mentions page the next refresh reads: newer than the newest stored", () =>
    Effect.gen(function* () {
      const costs = yield* Costs.Costs;
      const store = yield* EngageStore.EngageStore;
      const usd = Effect.map(costs.quote([{ kind: "mentions" }]), (r) => r.quotes[0]!.usd);
      meWarm = true;
      // The first refresh asks for everything; only that page is cached.
      mentionsWarm = [""];
      expect(yield* usd).toBe(0);
      // It stored mention 12, so the next refresh asks for newer ones: a page nobody has read.
      yield* store.storeApiMentions([mentionPost("12"), mentionPost("9")]);
      expect(yield* usd).toBe(XClient.RATE_CARD.readPage);
      mentionsWarm = ["", "12"];
      expect(yield* usd).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("quotes a picks fetch as due exactly when the fetch pays, on the user's day", () =>
    Effect.gen(function* () {
      const costs = yield* Costs.Costs;
      const library = yield* Library.Library;
      const settings = yield* SettingsStore.SettingsStore;
      const store = yield* LibraryStore.LibraryStore;
      yield* settings.update({ keywords: ["effect"], timeZone: "Australia/Sydney" });
      // 07:00 on Oct 23 in Sydney, still Oct 22 in UTC; the keyword was fetched on the UTC day.
      yield* TestClock.setTime(Date.parse("2026-10-22T20:00:00.000Z"));
      yield* store.picksRecord({ day: "2026-10-22", keyword: "effect", posts: [] });
      const picksQuote = Effect.map(costs.quote([{ kind: "picksFetch" }]), (r) => r.quotes[0]!.usd);

      searches = 0;
      expect(yield* picksQuote).toBe(XClient.RATE_CARD.searchPage);
      yield* library.picksFetch;
      expect(searches).toBe(1);
      expect(yield* picksQuote).toBe(0);
      yield* library.picksFetch;
      expect(searches).toBe(1);
    }).pipe(Effect.provide(layerPicks)),
  );
});

import type { CostAction, CostQuote, CostQuoteResult, SettingsError } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { POST_PAGES } from "../analyze/Analytics.ts";
import { MAX_KEYWORDS } from "../engage/Engage.ts";
import * as EngageStore from "../engage/EngageStore.ts";
import { MAX_PICK_KEYWORDS } from "../library/Library.ts";
import * as LibraryStore from "../library/LibraryStore.ts";
import { FOLLOWER_PAGES } from "../scores/Scores.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";

/**
 * Prices what a screen is about to do from the one rate card, and says when
 * the read cache would make the click free. Clients never carry a price.
 */
export class Costs extends Context.Service<
  Costs,
  {
    readonly quote: (
      actions: ReadonlyArray<CostAction>,
    ) => Effect.Effect<CostQuoteResult, SettingsError>;
  }
>()("xtend/costs/Costs") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const settings = yield* SettingsStore.SettingsStore;
  const library = yield* LibraryStore.LibraryStore;
  const engage = yield* EngageStore.EngageStore;
  const rates = XClient.RATE_CARD;

  const paid = (usd: number): CostQuote => ({ usd, cached: false });
  const read = (usd: number, cached: Effect.Effect<boolean>) =>
    Effect.map(cached, (hit): CostQuote => ({ usd: hit ? 0 : usd, cached: hit }));
  // Likes, reposts and mentions look up the connected account first, a paid read once a day.
  const withMe = (quote: Effect.Effect<CostQuote>) =>
    Effect.map(Effect.all([x.cached.me, quote]), ([meHit, q]): CostQuote =>
      meHit ? q : { usd: q.usd + rates.profile, cached: false },
    );

  const one = (action: CostAction): Effect.Effect<CostQuote, SettingsError> => {
    switch (action.kind) {
      case "post":
        return Effect.succeed(paid(XClient.postCostUsd(action.text)));
      case "like":
        return withMe(Effect.succeed(paid(rates.like)));
      case "repost":
        return withMe(Effect.succeed(paid(rates.repost)));
      case "dm":
        return Effect.succeed(paid(rates.dm));
      case "search":
        return read(rates.searchPage, x.cached.search(action.query, action.mode, action.cursor));
      case "profile":
        return read(rates.scraperProfile, x.cached.profile(action.handle));
      case "userPosts":
        return read(rates.searchPage, x.cached.userPosts(action.handle));
      case "followersPage":
        return read(rates.followersPage, x.cached.followers(action.handle, true));
      case "trending":
        return read(rates.trending, x.cached.trending(action.country));
      case "mentions":
        // The refresh asks for mentions after the newest one stored, so that is the page to probe.
        return withMe(
          read(
            rates.readPage,
            engage.latestApiMentionId.pipe(
              Effect.orElseSucceed(() => null),
              Effect.flatMap((sinceId) => x.cached.mentions(sinceId ?? undefined)),
            ),
          ),
        );
      case "scoreRun":
        // Only the profile and the first page are probeable; later pages hang off cursors the
        // probe cannot know, so they are always priced. A first page a new-follower check just
        // read must not make the whole run read as free.
        return Effect.map(
          Effect.all([x.cached.profile(action.handle), x.cached.followers(action.handle)]),
          ([profileHit, pageHit]) =>
            paid(
              (profileHit ? 0 : rates.scraperProfile) +
                (pageHit ? 0 : rates.followersPage) +
                (FOLLOWER_PAGES - 1) * rates.followersPage,
            ),
        );
      case "analyzeRefresh":
        return Effect.gen(function* () {
          const { handle } = yield* settings.get;
          const usd = rates.scraperProfile + POST_PAGES * rates.searchPage;
          if (handle === null) return paid(usd);
          return yield* read(
            usd,
            Effect.map(Effect.all([x.cached.profile(handle), x.cached.userPosts(handle)]), (hits) =>
              hits.every(Boolean),
            ),
          );
        });
      case "competitorFetch":
        return read(
          rates.scraperProfile + rates.searchPage,
          Effect.map(
            Effect.all([x.cached.profile(action.handle), x.cached.userPosts(action.handle)]),
            (hits) => hits.every(Boolean),
          ),
        );
      case "picksFetch":
        return Effect.gen(function* () {
          const { keywords, timeZone } = yield* settings.get;
          // The user's day, as Library.picksFetch keys it; a UTC day would quote $0 for a due fetch.
          const day = DateTime.formatIsoDate(
            DateTime.setZone(yield* DateTime.now, SettingsStore.zoneOf(timeZone)),
          );
          const fetched = yield* library
            .pickFetchedKeywords(day)
            .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
          const pending = keywords.slice(0, MAX_PICK_KEYWORDS).filter((k) => !fetched.includes(k));
          return paid(pending.length * rates.searchPage);
        });
      case "engageTargets":
        return Effect.gen(function* () {
          const { keywords } = yield* settings.get;
          const hits = yield* Effect.forEach(keywords.slice(0, MAX_KEYWORDS), (k) =>
            x.cached.search(k, "latest"),
          );
          const cold = hits.filter((h) => !h).length;
          return { usd: cold * rates.searchPage, cached: hits.length > 0 && cold === 0 };
        });
      case "findKeywords":
        return Effect.gen(function* () {
          const { handle } = yield* settings.get;
          return handle === null
            ? paid(rates.searchPage)
            : yield* read(rates.searchPage, x.cached.userPosts(handle));
        });
    }
  };

  const quote = Effect.fn("Costs.quote")(function* (actions: ReadonlyArray<CostAction>) {
    const quotes = yield* Effect.forEach(actions, one);
    return { rates, quotes };
  });

  return Costs.of({ quote });
});

export const layer = Layer.effect(Costs, make).pipe(
  Layer.provide(Layer.mergeAll(LibraryStore.layer, EngageStore.layer)),
);

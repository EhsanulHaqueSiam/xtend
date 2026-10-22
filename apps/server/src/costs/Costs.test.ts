import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as XClient from "../x/XClient.ts";
import * as Costs from "./Costs.ts";

const layerTest = Costs.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      xClientStub({
        cached: {
          search: (query) => Effect.succeed(query === "warm"),
          profile: () => Effect.succeed(false),
          userPosts: () => Effect.succeed(false),
          followers: () => Effect.succeed(false),
          trending: () => Effect.succeed(true),
          mentions: Effect.succeed(false),
        },
      }),
    ),
  ),
);

describe("Costs", () => {
  it.effect("quotes from the one rate card and marks cached reads free", () =>
    Effect.gen(function* () {
      const costs = yield* Costs.Costs;
      const { rates, quotes } = yield* costs.quote([
        { kind: "post", text: "plain" },
        { kind: "post", text: "see https://x.com" },
        { kind: "search", query: "cold" },
        { kind: "search", query: "warm" },
        { kind: "trending", country: "UnitedStates" },
        { kind: "scoreRun", handle: "levelsio" },
      ]);
      expect(rates).toEqual(XClient.RATE_CARD);
      expect(quotes.map((q) => q.usd)).toEqual([
        rates.post,
        rates.postWithLink,
        rates.searchPage,
        0,
        0,
        rates.scraperProfile + 5 * rates.followersPage,
      ]);
      expect(quotes.map((q) => q.cached)).toEqual([false, false, false, true, true, false]);
    }).pipe(Effect.provide(layerTest)),
  );
});

import type { CostAction } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterAll, expect, test } from "vite-plus/test";

import * as Analytics from "./analyze/Analytics.ts";
import * as RuleStore from "./automate/RuleStore.ts";
import * as DraftStore from "./compose/DraftStore.ts";
import * as Costs from "./costs/Costs.ts";
import * as PeopleStore from "./leads/PeopleStore.ts";
import * as LibraryStore from "./library/LibraryStore.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Seed from "./testing/seed.ts";

/**
 * What a screen waits on in the service before its first paint: the method behind each list rpc
 * and the cost labels, on a heavy user's database (testing/seed.ts), called in-process. The
 * socket and the encoding come on top; payloads.test.ts holds the sizes.
 */
const runtime = ManagedRuntime.make(Seed.layer);
afterAll(() => runtime.dispose());

const timed =
  <A, E>(effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>) =>
  async () => {
    await runtime.runPromise(effect);
  };

// Few samples of the slow ones are enough; a second of the fast ones.
const RUN = { iterations: 20, warmupIterations: 5 };

// Engage's Targets screen labels four buttons, one quote rpc each; its reads are warm in the seed.
const ENGAGE_QUOTES: ReadonlyArray<CostAction> = [
  { kind: "engageTargets" },
  { kind: "findKeywords" },
  { kind: "assist" },
  { kind: "like" },
];
const engageQuotes = Costs.Costs.use((costs) =>
  Effect.forEach(ENGAGE_QUOTES, (action) => costs.quote([action])),
);

test("list screens and quotes", async ({ bench }) => {
  // The quotes must probe the warm cache, or the bench measures misses.
  const quotes = await runtime.runPromise(engageQuotes);
  expect(quotes.slice(0, 2).map((q) => q.quotes[0]?.cached)).toEqual([true, true]);

  await bench.compare(
    bench(
      "observations.listRecent 100",
      timed(ObservationStore.ObservationStore.use((s) => s.listRecent({ limit: 100 }))),
    ),
    bench("leads.peopleList", timed(PeopleStore.PeopleStore.use((s) => s.list()))),
    bench("compose.draftsList", timed(DraftStore.DraftStore.use((s) => s.list))),
    bench("automate.runsList", timed(RuleStore.RuleStore.use((s) => s.runs({})))),
    bench("analyze.data", timed(Analytics.Analytics.use((s) => s.data))),
    bench("library.savedList", timed(LibraryStore.LibraryStore.use((s) => s.savedList({})))),
    bench("library.browse", timed(LibraryStore.LibraryStore.use((s) => s.browse({})))),
    bench("costs.quote x4, Engage targets", timed(engageQuotes)),
    RUN,
  );
});

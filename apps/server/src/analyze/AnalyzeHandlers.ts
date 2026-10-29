import { Analyze_METHODS, AnalyzeRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ScoreStore from "../scores/ScoreStore.ts";
import * as Treg from "../x/Treg.ts";
import * as Analytics from "./Analytics.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";
import * as PostAnalytics from "./PostAnalytics.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
// Treg is provided here as XClient does it: Effect memoizes the layer, so both share the one door.
export const layer = Analytics.layer.pipe(
  Layer.provideMerge(PostAnalytics.layer.pipe(Layer.provide(Treg.layer))),
  Layer.provideMerge(Layer.mergeAll(AnalyticsStore.layer, ScoreStore.layer)),
);

/** RPC handlers for AnalyzeRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = AnalyzeRpcGroup.toLayer(
  Effect.gen(function* () {
    const analytics = yield* Analytics.Analytics;
    return AnalyzeRpcGroup.of({
      [Analyze_METHODS.data]: () => analytics.data,
      [Analyze_METHODS.refresh]: () => analytics.refresh,
      [Analyze_METHODS.engagers]: () => analytics.engagers,
      [Analyze_METHODS.themes]: () => analytics.themes,
      [Analyze_METHODS.competitors]: () => analytics.competitors,
      [Analyze_METHODS.competitorFetch]: ({ handle }) => analytics.competitorFetch(handle),
      [Analyze_METHODS.ask]: ({ question }) => analytics.ask(question),
      [Analyze_METHODS.refreshNonPublic]: () => analytics.refreshNonPublic,
      [Analyze_METHODS.nightlySet]: ({ on }) => analytics.nightlySet(on),
      [Analyze_METHODS.postStrip]: ({ postIds }) => analytics.postStrip(postIds),
    });
  }),
);

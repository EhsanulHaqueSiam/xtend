import { Scores_METHODS, ScoresRpcGroup } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Scores from "./Scores.ts";
import * as ScoreStore from "./ScoreStore.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Scores.layer.pipe(Layer.provideMerge(ScoreStore.layer));

/** RPC handlers for ScoresRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = ScoresRpcGroup.toLayer(
  Effect.gen(function* () {
    const scores = yield* Scores.Scores;
    const store = yield* ScoreStore.ScoreStore;
    return ScoresRpcGroup.of({
      [Scores_METHODS.report]: ({ handle }) => scores.report(handle),
      [Scores_METHODS.run]: ({ handle, pages }) => scores.run(handle, pages),
      [Scores_METHODS.watchList]: () => store.watchList,
      [Scores_METHODS.watchAdd]: Effect.fn("Scores.watchAdd")(function* ({ handle }) {
        yield* store.watchAdd(handle, DateTime.formatIso(yield* DateTime.now));
        return yield* store.watchList;
      }),
      [Scores_METHODS.watchRemove]: ({ handle }) =>
        Effect.andThen(store.watchRemove(handle), store.watchList),
      [Scores_METHODS.trending]: ({ country }) => scores.trending(country),
    });
  }),
);

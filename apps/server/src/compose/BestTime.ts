import { ComposeError, type Heatmap } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

/** Below this many observed posts the heatmap is noise, so no slot suggestion is made. */
const MIN_POSTS = 10;

export class BestTime extends Context.Service<
  BestTime,
  { readonly heatmap: Effect.Effect<Heatmap, ComposeError> }
>()("xtend/compose/BestTime") {}

const make = Effect.gen(function* () {
  const observations = yield* ObservationStore.ObservationStore;
  const settings = yield* SettingsStore.SettingsStore;

  const heatmap = Effect.gen(function* () {
    const { handle, timeZone } = yield* settings.get;
    const { posts } =
      handle === null
        ? { posts: [] }
        : yield* observations.listRecent({ authorHandle: handle, limit: 200 });
    const zone = SettingsStore.zoneOf(timeZone);
    const cells = Array.from({ length: 168 }, () => 0);
    for (const p of posts) {
      const { weekDay, hour } = DateTime.toParts(
        DateTime.setZone(DateTime.makeUnsafe(p.createdAt), zone),
      );
      const i = weekDay * 24 + hour;
      cells[i] = (cells[i] ?? 0) + Math.log1p(p.metrics.views ?? 0);
    }
    const best =
      posts.length < MIN_POSTS
        ? []
        : cells
            .map((v, i) => ({ v, i }))
            .filter(({ v }) => v > 0)
            .sort((a, b) => b.v - a.v)
            .slice(0, 3)
            .map(({ i }) => ({ weekday: Math.floor(i / 24), hour: i % 24 }));
    return { cells, posts: posts.length, best } satisfies Heatmap;
  }).pipe(Effect.mapError((e) => new ComposeError({ operation: "heatmap", detail: e.message })));

  return BestTime.of({ heatmap });
});

export const layer = Layer.effect(BestTime, make);

import {
  LibraryError,
  type Pick,
  type TrendIdea,
  type XApiError,
  type XPost,
  type XSearchMode,
  type XTrend,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as LibraryStore from "./LibraryStore.ts";

/** Treg's price for one search page; the picks tab shows it before the first fetch of the day. */
const SEARCH_COST_USD = 0.00075;
const MAX_PICK_KEYWORDS = 5;

export interface PicksState {
  readonly day: string;
  readonly keywords: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<string>;
  readonly picks: ReadonlyArray<Pick>;
}

const assistError = (e: Assist.AssistError) =>
  new LibraryError({ operation: "assist", detail: e.message });
const settingsError = (e: { readonly message: string }) =>
  new LibraryError({ operation: "settings", detail: e.message });

/** Library reads and model calls: search, daily picks, trend ideas. Persistence is LibraryStore. */
export class Library extends Context.Service<
  Library,
  {
    readonly search: (input: {
      readonly query: string;
      readonly mode: XSearchMode;
      readonly cursor?: string | undefined;
    }) => Effect.Effect<XClient.Page<XPost>, XApiError>;
    readonly picksGet: Effect.Effect<PicksState, LibraryError>;
    readonly picksFetch: Effect.Effect<PicksState, LibraryError | XApiError>;
    readonly pickWhy: (postId: string) => Effect.Effect<string, LibraryError>;
    readonly pickDraft: (postId: string) => Effect.Effect<ReadonlyArray<string>, LibraryError>;
    readonly trends: (country: string) => Effect.Effect<ReadonlyArray<XTrend>, XApiError>;
    readonly trendIdeas: (
      country: string,
    ) => Effect.Effect<ReadonlyArray<TrendIdea>, LibraryError | XApiError>;
  }
>()("xtend/library/Library") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const store = yield* LibraryStore.LibraryStore;

  const today = Effect.map(DateTime.now, (d) => DateTime.formatIso(d).slice(0, 10));
  const keywords = settings.get.pipe(
    Effect.map((s) => s.keywords.slice(0, MAX_PICK_KEYWORDS)),
    Effect.mapError(settingsError),
  );

  const search = Effect.fn("Library.search")(function* (input: {
    readonly query: string;
    readonly mode: XSearchMode;
    readonly cursor?: string | undefined;
  }) {
    return yield* x.searchPosts(input.query, {
      mode: input.mode,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      purpose: "library.search",
    });
  });

  const picksState = Effect.fn("Library.picksState")(function* (day: string) {
    const all = yield* keywords;
    const fetched = yield* store.pickFetchedKeywords(day);
    return {
      day,
      keywords: all,
      pending: all.filter((k) => !fetched.includes(k)),
      picks: yield* store.picksForDay(day),
    } satisfies PicksState;
  });

  const picksGet = Effect.flatMap(today, picksState);

  const picksFetch = Effect.gen(function* () {
    const day = yield* today;
    const state = yield* picksState(day);
    const since = DateTime.formatIso(
      DateTime.subtractDuration(yield* DateTime.now, Duration.days(7)),
    ).slice(0, 10);
    for (const keyword of state.pending) {
      const page = yield* x.searchPosts(`${keyword} min_faves:200 since:${since}`, {
        mode: "top",
        purpose: "library.picks",
      });
      yield* store.picksRecord({ day, keyword, posts: page.items });
    }
    return yield* picksState(day);
  });

  const pickWhy = Effect.fn("Library.pickWhy")(function* (postId: string) {
    const pick = yield* store.pickGet(postId);
    if (pick === null)
      return yield* new LibraryError({ operation: "store", detail: "Pick not found." });
    if (pick.whyItWorks !== null) return pick.whyItWorks;
    const { why } = yield* assist
      .generate({
        task: "library.pickWhy",
        instructions:
          "Explain in exactly two short lines why this post performed: line 1 covers the hook, line 2 the structure and format. No preamble.",
        input: { text: pick.post.text, metrics: pick.post.metrics, hasMedia: pick.post.hasMedia },
        output: Schema.Struct({ why: Schema.String }),
      })
      .pipe(Effect.mapError(assistError));
    yield* store.pickSetWhy(postId, why);
    return why;
  });

  const pickDraft = Effect.fn("Library.pickDraft")(function* (postId: string) {
    const cached = yield* store.pickDraftGet(postId);
    if (cached !== null) return cached;
    const pick = yield* store.pickGet(postId);
    if (pick === null)
      return yield* new LibraryError({ operation: "store", detail: "Pick not found." });
    const { blocks } = yield* assist
      .generate({
        task: "library.pickDraft",
        instructions:
          "Write a new post in the user's voice on the same angle as the input post. Do not copy its wording. One block per post; use several blocks only when a thread is clearly better. Each block under 280 characters.",
        input: { text: pick.post.text },
        output: Schema.Struct({ blocks: Schema.Array(Schema.String) }),
      })
      .pipe(Effect.mapError(assistError));
    yield* store.pickSetDraft(postId, blocks);
    return blocks;
  });

  const trends = Effect.fn("Library.trends")(function* (country: string) {
    return yield* x.trending(country, "library.trends");
  });

  const trendIdeas = Effect.fn("Library.trendIdeas")(function* (country: string) {
    const list = yield* trends(country);
    const { ideas } = yield* assist
      .generate({
        task: "library.trendIdeas",
        instructions:
          "From these trends, return exactly 5 post ideas that fit the user's niche keywords. Each idea names the trend, the angle that ties it to the niche, and a ready-to-post draft under 280 characters in the user's voice. Skip trends with no honest link to the niche.",
        input: {
          trends: list.slice(0, 30).map((t) => ({ name: t.name, context: t.context })),
          keywords: yield* keywords,
        },
        output: Schema.Struct({
          ideas: Schema.Array(
            Schema.Struct({ trend: Schema.String, angle: Schema.String, text: Schema.String }),
          ),
        }),
      })
      .pipe(Effect.mapError(assistError));
    return ideas;
  });

  return Library.of({ search, picksGet, picksFetch, pickWhy, pickDraft, trends, trendIdeas });
});

export const layer = Layer.effect(Library, make);

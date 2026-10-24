import {
  HookPattern,
  LibraryError,
  type Pick,
  PostFormat,
  type ReadyPost,
  StaffPick,
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
import * as DraftStore from "../compose/DraftStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as LibraryStore from "./LibraryStore.ts";
import staffPicksJson from "./staffPicks.json" with { type: "json" };

export const MAX_PICK_KEYWORDS = 5;
/** Posts one pattern detection call labels. */
const DETECT_BATCH = 20;
const READY_COUNT = 3;

const StaffPickEntry = Schema.Struct({
  handle: Schema.String,
  postId: Schema.String,
  topic: StaffPick.fields.topic,
});
const STAFF_PICKS = Schema.decodeUnknownSync(Schema.Array(StaffPickEntry))(staffPicksJson);

const Labels = Schema.Struct({
  labels: Schema.Array(
    Schema.Struct({ postId: Schema.String, format: PostFormat, hookPattern: HookPattern }),
  ),
});

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
    readonly detectPatterns: Effect.Effect<
      { readonly detected: number; readonly remaining: number },
      LibraryError
    >;
    readonly writeInFormat: (
      postId: string,
    ) => Effect.Effect<{ readonly id: string; readonly text: string }, LibraryError>;
    readonly staffPicks: Effect.Effect<ReadonlyArray<StaffPick>, LibraryError>;
    readonly staffPicksFetch: Effect.Effect<ReadonlyArray<StaffPick>, LibraryError | XApiError>;
    readonly generateReady: (
      country: string,
    ) => Effect.Effect<ReadonlyArray<ReadyPost>, LibraryError | XApiError>;
  }
>()("xtend/library/Library") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const store = yield* LibraryStore.LibraryStore;
  const drafts = yield* DraftStore.DraftStore;

  // The user's local day, the one DailyJobs runs the picks job on; a UTC day would roll over and
  // hide the morning's picks partway through the user's day.
  const today = Effect.gen(function* () {
    const { timeZone } = yield* settings.get.pipe(Effect.mapError(settingsError));
    return DateTime.formatIsoDate(
      DateTime.setZone(yield* DateTime.now, SettingsStore.zoneOf(timeZone)),
    );
  });
  const keywords = settings.get.pipe(
    Effect.map((s) => s.keywords.slice(0, MAX_PICK_KEYWORDS)),
    Effect.mapError(settingsError),
  );

  const search = Effect.fn("Library.search")(function* (input: {
    readonly query: string;
    readonly mode: XSearchMode;
    readonly cursor?: string | undefined;
  }) {
    const page = yield* x.searchPosts(input.query, {
      mode: input.mode,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      purpose: "library.search",
    });
    yield* store.upsertPosts(page.items).pipe(Effect.orElseSucceed(() => undefined));
    return page;
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
      yield* store.upsertPosts(page.items);
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

  const detectPatterns = Effect.gen(function* () {
    const batch = yield* store.undetected(DETECT_BATCH);
    let detected = 0;
    if (batch.length > 0) {
      const { labels } = yield* assist
        .generate({
          task: "library.detectPatterns",
          instructions:
            "For each post, return its format (thread when the text is clearly the first post of a thread, otherwise keep the given format) and the hook pattern of its first line: contrarian claim, list, story, question, number hook, how-to, announcement, or other. One label per postId, no post skipped.",
          input: batch.map((p) => ({ postId: p.post.postId, format: p.format, text: p.post.text })),
          output: Labels,
        })
        .pipe(Effect.mapError(assistError));
      const given = new Map(batch.map((p) => [p.post.postId, p.format]));
      // Media, link and text come from the post's own flags; the model only gets to say thread.
      const applied = labels.flatMap((l) => {
        const format = given.get(l.postId);
        return format === undefined
          ? []
          : [{ ...l, format: l.format === "thread" ? l.format : format }];
      });
      yield* store.setPatterns(applied);
      // A post the model skipped or invented is not labelled, whatever the batch size was.
      detected = new Set(applied.map((l) => l.postId)).size;
    }
    return { detected, remaining: yield* store.undetectedCount };
  });

  const draftError = (e: { readonly message: string }) =>
    new LibraryError({ operation: "store", detail: e.message });

  const writeInFormat = Effect.fn("Library.writeInFormat")(function* (postId: string) {
    const entry = yield* store.libraryPost(postId);
    if (entry === null)
      return yield* new LibraryError({ operation: "store", detail: "Post not in the archive." });
    const pattern = entry.hookPattern ?? "other";
    const { text } = yield* assist
      .generate({
        task: "library.writeInFormat",
        instructions: `Write one new post in the user's voice on a topic from their keywords, using the same format (${entry.format}) and the same hook pattern (${pattern}) as the example. Do not reuse the example's topic or wording. Under 280 characters.`,
        input: { example: entry.post.text, format: entry.format, hookPattern: pattern },
        output: Schema.Struct({ text: Schema.String }),
      })
      .pipe(Effect.mapError(assistError));
    const draft = yield* drafts
      .create({ blocks: [{ text }], status: "suggested", source: `format:${pattern}:${postId}` })
      .pipe(Effect.mapError(draftError));
    return { id: draft.id, text };
  });

  const staffPicks = Effect.forEach(STAFF_PICKS, (s) =>
    Effect.map(store.libraryPost(s.postId), (entry): StaffPick => ({
      ...s,
      post: entry?.post ?? null,
    })),
  );

  // One search per handle still missing a post; a pick whose id the search does not return stays empty.
  const staffPicksFetch = Effect.gen(function* () {
    const current = yield* staffPicks;
    const handles = new Set(current.filter((s) => s.post === null).map((s) => s.handle));
    for (const handle of handles) {
      const page = yield* x.searchPosts(`from:${handle}`, {
        mode: "top",
        purpose: "library.staffPicks",
      });
      yield* store.upsertPosts(page.items);
    }
    return yield* staffPicks;
  });

  const generateReady = Effect.fn("Library.generateReady")(function* (country: string) {
    const list = yield* trends(country);
    const picks = yield* store.picksForDay(yield* today);
    const { posts } = yield* assist
      .generate({
        task: "library.generateReady",
        instructions: `Write exactly ${READY_COUNT} posts the user could publish today, each built on one of the trends or picks given, in the user's voice, under 280 characters, no hashtags. For each give the basis (the trend name or the pick's author handle) and voiceMatch, 0 to 100, your honest estimate of how close the text is to the user's voice notes and past tone.`,
        input: {
          trends: list.slice(0, 15).map((t) => t.name),
          picks: picks
            .slice(0, 10)
            .map((p) => ({ author: p.post.author.handle, text: p.post.text })),
        },
        output: Schema.Struct({
          posts: Schema.Array(
            Schema.Struct({ text: Schema.String, basis: Schema.String, voiceMatch: Schema.Int }),
          ),
        }),
      })
      .pipe(Effect.mapError(assistError));
    return yield* Effect.forEach(posts.slice(0, READY_COUNT), (p) =>
      drafts
        .create({
          blocks: [{ text: p.text }],
          status: "suggested",
          source: `ready-to-post: ${p.basis} (voice ${p.voiceMatch})`,
        })
        .pipe(
          Effect.map((d): ReadyPost => ({ draftId: d.id, ...p })),
          Effect.mapError(draftError),
        ),
    );
  });

  return Library.of({
    search,
    picksGet,
    picksFetch,
    pickWhy,
    pickDraft,
    trends,
    trendIdeas,
    detectPatterns,
    writeInFormat,
    staffPicks,
    staffPicksFetch,
    generateReady,
  });
});

export const layer = Layer.effect(Library, make);

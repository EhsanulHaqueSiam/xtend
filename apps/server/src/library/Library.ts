import {
  type ForYouTopic,
  HookPattern,
  LibraryError,
  type Pick,
  PostFormat,
  type ReadyPost,
  type ReplyTone,
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
import * as ObservationStore from "../observations/ObservationStore.ts";
import { bestOwn, leadingHandles } from "../observations/own.ts";
import * as Pool from "../pool/Pool.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import { interests, rankTopics } from "./forYou.ts";
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

/** Library reads and model calls: search, daily picks, trends, for-you topics. Persistence is LibraryStore. */
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
    /** Three options on the pick's angle, each one post or a short thread. */
    readonly pickDraft: (
      postId: string,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, LibraryError>;
    readonly trends: (country: string) => Effect.Effect<ReadonlyArray<XTrend>, XApiError>;
    readonly trendIdeas: (
      country: string,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<TrendIdea>, LibraryError | XApiError>;
    readonly detectPatterns: Effect.Effect<
      { readonly detected: number; readonly remaining: number },
      LibraryError
    >;
    /** Three options in the example's format; the user keeps one as a draft. */
    readonly writeInFormat: (
      postId: string,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<string>, LibraryError>;
    readonly staffPicks: Effect.Effect<ReadonlyArray<StaffPick>, LibraryError>;
    readonly staffPicksFetch: Effect.Effect<ReadonlyArray<StaffPick>, LibraryError | XApiError>;
    /** Free: the session capture, saved posts and the pool, ranked on this machine. */
    readonly forYou: Effect.Effect<ReadonlyArray<ForYouTopic>, LibraryError>;
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
  const observations = yield* ObservationStore.ObservationStore;
  const pool = yield* Pool.Pool;

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

  // Never cached: asking again, or in another tone, is the point of the chooser.
  const pickDraft = Effect.fn("Library.pickDraft")(function* (postId: string, tone?: ReplyTone) {
    const pick = yield* store.pickGet(postId);
    if (pick === null)
      return yield* new LibraryError({ operation: "store", detail: "Pick not found." });
    const { options } = yield* assist
      .generate({
        task: "library.pickDraft",
        tone,
        instructions:
          "Write 3 different new posts in the user's voice on the same angle as the input post. Do not copy its wording. Each option is a list of blocks, one per post; use several blocks only when a thread is clearly better. Each block under 280 characters.",
        input: { text: pick.post.text },
        output: Schema.Struct({
          options: Schema.Array(Schema.Struct({ blocks: Schema.Array(Schema.String) })),
        }),
      })
      .pipe(Effect.mapError(assistError));
    return options.map((o) => o.blocks).slice(0, 3);
  });

  const trends = Effect.fn("Library.trends")(function* (country: string) {
    return yield* x.trending(country, "library.trends");
  });

  const trendIdeas = Effect.fn("Library.trendIdeas")(function* (country: string, tone?: ReplyTone) {
    const list = yield* trends(country);
    const { ideas } = yield* assist
      .generate({
        task: "library.trendIdeas",
        tone,
        instructions:
          "From these trends, return exactly 3 post ideas that fit the user's niche keywords. Each idea names the trend, the angle that ties it to the niche, and a ready-to-post draft under 280 characters in the user's voice. Skip trends with no honest link to the niche.",
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

  const writeInFormat = Effect.fn("Library.writeInFormat")(function* (
    postId: string,
    tone?: ReplyTone,
  ) {
    const entry = yield* store.libraryPost(postId);
    if (entry === null)
      return yield* new LibraryError({ operation: "store", detail: "Post not in the archive." });
    const pattern = entry.hookPattern ?? "other";
    const { drafts } = yield* assist
      .generate({
        task: "library.writeInFormat",
        tone,
        instructions: `Write 3 different new posts in the user's voice on a topic from their keywords, using the same format (${entry.format}) and the same hook pattern (${pattern}) as the example. Do not reuse the example's topic or wording. Each under 280 characters.`,
        input: { example: entry.post.text, format: entry.format, hookPattern: pattern },
        output: Schema.Struct({ drafts: Schema.Array(Schema.String) }),
      })
      .pipe(Effect.mapError(assistError));
    return drafts.slice(0, 3);
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

  const observedError = (e: { readonly message: string }) =>
    new LibraryError({ operation: "store", detail: e.message });
  const ownPosts = (handle: string | null) =>
    handle === null
      ? Effect.succeed([])
      : observations.listRecent({ limit: 200, authorHandle: handle }).pipe(
          Effect.map((r) => r.posts),
          Effect.mapError(observedError),
        );

  const forYou = Effect.gen(function* () {
    const s = yield* settings.get.pipe(Effect.mapError(settingsError));
    const own = yield* ownPosts(s.handle);
    const saved = yield* store.savedList({});
    const feed = yield* observations
      .listRecent({ limit: 200 })
      .pipe(Effect.mapError(observedError));
    // The pool is a bonus: offline or empty, the feed alone still ranks.
    const rising = yield* pool.trends.pipe(
      Effect.map((t) => t.rising),
      Effect.orElseSucceed(() => []),
    );
    const profile = interests({
      keywords: s.keywords,
      ownTexts: own.map((p) => p.text),
      savedTexts: saved.map((p) => p.post.text),
      closeHandles: [
        ...own.filter((p) => p.isReply).flatMap((p) => leadingHandles(p.text)),
        ...saved.map((p) => p.post.author.handle),
      ],
    });
    return rankTopics({
      profile,
      feed: feed.posts,
      rising,
      self: s.handle,
      nowMs: DateTime.toEpochMillis(yield* DateTime.now),
    });
  });

  const generateReady = Effect.fn("Library.generateReady")(function* (country: string) {
    const topics = yield* forYou;
    // Country trends are the cold start, before the session or the pool knows the user.
    const basis =
      topics.length > 0
        ? topics.map((t) => ({ topic: t.term, why: t.reason }))
        : (yield* trends(country)).slice(0, 15).map((t) => ({ topic: t.name, why: "trending" }));
    const picks = yield* store.picksForDay(yield* today);
    const { handle } = yield* settings.get.pipe(Effect.mapError(settingsError));
    const { posts } = yield* assist
      .generate({
        task: "library.generateReady",
        instructions: `Write exactly ${READY_COUNT} posts the user could publish today, each built on one of the topics or picks given, in the user's voice, under 280 characters, no hashtags. Topics come ranked by fit with the user; prefer the top ones, and use an "outside your usual topics" one only with an honest link to the niche. The user's own posts that did best are their taste: match their length, structure and attitude, never their wording. For each give the basis (the topic or the pick's author handle) and voiceMatch, 0 to 100, your honest estimate of how close the text is to the user's voice notes and past tone.`,
        input: {
          topics: basis,
          picks: picks
            .slice(0, 10)
            .map((p) => ({ author: p.post.author.handle, text: p.post.text })),
          yourBestPosts: bestOwn(yield* ownPosts(handle), "posts"),
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
    forYou,
    generateReady,
  });
});

export const layer = Layer.effect(Library, make);

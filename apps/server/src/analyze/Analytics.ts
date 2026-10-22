import {
  type AccountPost,
  type AnalyzeData,
  AnalyzeError,
  AskAnswer,
  CompetitorReport,
  type Engager,
  type HeatmapCell,
  Theme,
  type XPost,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as ScoreStore from "../scores/ScoreStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";

/** Pages of own posts one refresh reads; the UI quotes POST_PAGES * 0.00075 before the click. */
const POST_PAGES = 5;
const MAX_POSTS = 100;

const ThemesJson = Schema.fromJsonString(Schema.Array(Theme));
const CompetitorJson = Schema.fromJsonString(CompetitorReport);

// shortcut: a thread is guessed from "1/" or the thread emoji in the text; the scraper has no self-reply flag.
const looksLikeThread = (text: string) => /🧵|(^|\s|\()1\/\d*/.test(text);

const toAccountPost = (p: XPost): AccountPost => ({
  postId: p.postId,
  url: p.url,
  text: p.text,
  createdAt: p.createdAt,
  kind: p.isReply
    ? "reply"
    : looksLikeThread(p.text)
      ? "thread"
      : p.hasMedia
        ? "media"
        : p.hasLink
          ? "link"
          : "text",
  views: p.metrics.views,
  likes: p.metrics.likes,
  reposts: p.metrics.reposts,
  replies: p.metrics.replies,
  quotes: p.metrics.quotes,
  bookmarks: p.metrics.bookmarks,
});

const engagementRate = (p: AccountPost): number =>
  p.views === null || p.views === 0
    ? 0
    : (p.likes + p.reposts + p.replies + p.quotes + p.bookmarks) / p.views;

/** Hour-of-week cells with at least one post; the UI fills the empty ones. */
const heatmapOf = (posts: ReadonlyArray<AccountPost>): ReadonlyArray<HeatmapCell> => {
  const cells = new Map<number, { posts: number; views: number }>();
  for (const p of posts) {
    const d = DateTime.toPartsUtc(DateTime.makeUnsafe(p.createdAt));
    const key = d.weekDay * 24 + d.hour;
    const cell = cells.get(key) ?? { posts: 0, views: 0 };
    cells.set(key, { posts: cell.posts + 1, views: cell.views + (p.views ?? 0) });
  }
  return [...cells].map(([key, c]) => ({
    weekday: Math.floor(key / 24),
    hour: key % 24,
    posts: c.posts,
    avgViews: c.views / c.posts,
  }));
};

const avgViews = (posts: ReadonlyArray<AccountPost>) =>
  posts.length === 0 ? 0 : posts.reduce((s, p) => s + (p.views ?? 0), 0) / posts.length;

export class Analytics extends Context.Service<
  Analytics,
  {
    readonly data: Effect.Effect<AnalyzeData, AnalyzeError>;
    /** Fetches the profile (snapshotting it) and up to MAX_POSTS own posts. */
    readonly refresh: Effect.Effect<AnalyzeData, AnalyzeError>;
    readonly engagers: Effect.Effect<ReadonlyArray<Engager>, AnalyzeError>;
    readonly themes: Effect.Effect<ReadonlyArray<Theme>, AnalyzeError>;
    readonly competitors: Effect.Effect<ReadonlyArray<CompetitorReport>, AnalyzeError>;
    readonly competitorFetch: (handle: string) => Effect.Effect<CompetitorReport, AnalyzeError>;
    readonly ask: (question: string) => Effect.Effect<AskAnswer, AnalyzeError>;
  }
>()("xtend/analyze/Analytics") {}

const fail = (operation: string) => (cause: { readonly message: string }) =>
  new AnalyzeError({ operation, detail: cause.message });

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const observations = yield* ObservationStore.ObservationStore;
  const scoreStore = yield* ScoreStore.ScoreStore;
  const store = yield* AnalyticsStore.AnalyticsStore;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const handle = settings.get.pipe(
    Effect.map((s) => s.handle),
    Effect.mapError(fail("settings")),
  );
  const requireHandle = Effect.flatMap(handle, (h) =>
    h === null
      ? Effect.fail(
          new AnalyzeError({ operation: "handle", detail: "set your X handle in Settings" }),
        )
      : Effect.succeed(h),
  );

  const userPosts = (h: string, pages: number, purpose: string) =>
    Effect.gen(function* () {
      const posts: Array<AccountPost> = [];
      let cursor: string | null = null;
      for (let page = 0; page < pages && posts.length < MAX_POSTS; page++) {
        const result: XClient.Page<XPost> = yield* x.userPosts(h, {
          purpose,
          ...(cursor === null ? {} : { cursor }),
        });
        posts.push(...result.items.map(toAccountPost));
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
      return posts.slice(0, MAX_POSTS);
    });

  const data = Effect.gen(function* () {
    const h = yield* handle;
    if (h === null) return { handle: null, fetchedAt: null, posts: [], snapshots: [], heatmap: [] };
    const { posts, fetchedAt } = yield* store.listPosts(h);
    const snapshots = yield* store.listSnapshots(h);
    return { handle: h, fetchedAt, posts, snapshots, heatmap: heatmapOf(posts) };
  });

  const refresh = Effect.gen(function* () {
    const h = yield* requireHandle;
    const profile = yield* x.profile(h, "analyze.refresh");
    const at = yield* nowIso;
    if (profile !== null)
      yield* store.saveSnapshot(h, {
        day: at.slice(0, 10),
        followers: profile.followers,
        following: profile.following,
        posts: profile.posts,
      });
    yield* store.replacePosts(h, yield* userPosts(h, POST_PAGES, "analyze.refresh"), at);
    return yield* data;
  }).pipe(Effect.mapError(fail("refresh")));

  const engagers = Effect.gen(function* () {
    const own = yield* handle;
    const { posts } = yield* observations.listRecent({ limit: 200 });
    const byHandle = new Map<string, Engager>();
    for (const p of posts) {
      if (p.author.handle === own) continue;
      const e = byHandle.get(p.author.handle);
      byHandle.set(p.author.handle, {
        handle: p.author.handle,
        name: p.author.name,
        followers: p.author.followers,
        verified: p.author.verified,
        seen: (e?.seen ?? 0) + p.observations,
      });
    }
    const weight = (e: Engager) => e.seen * Math.log10((e.followers ?? 0) + 10);
    return [...byHandle.values()].sort((a, b) => weight(b) - weight(a)).slice(0, 50);
  }).pipe(Effect.mapError(fail("engagers")));

  const bestPosts = Effect.map(data, (d) =>
    [...d.posts].sort((a, b) => engagementRate(b) - engagementRate(a)).slice(0, 50),
  );

  const themes = Effect.gen(function* () {
    const best = yield* bestPosts;
    if (best.length === 0) return [];
    const key = `themes:${best.map((p) => p.postId).join(",")}`;
    const cached = yield* store.cacheGet(key);
    if (cached !== null) return Schema.decodeUnknownSync(ThemesJson)(cached);
    const result = yield* assist.generate({
      task: "analyze.themes",
      instructions:
        "These are the user's best performing posts by engagement rate. Group them into exactly 5 themes. For each theme give a short name, the ids of the posts that belong to it, and one sentence on why that theme works for this account.",
      input: best.map((p) => ({ id: p.postId, text: p.text, views: p.views, likes: p.likes })),
      output: Schema.Array(Theme),
    });
    yield* store.cacheSet(key, Schema.encodeSync(ThemesJson)(result), yield* nowIso);
    return result;
  }).pipe(Effect.mapError(fail("themes")));

  const competitors = Effect.gen(function* () {
    const watched = yield* scoreStore.watchList;
    const reports: Array<CompetitorReport> = [];
    for (const w of watched) {
      const cached = yield* store.cacheGet(`competitor:${w.handle}`);
      if (cached !== null) reports.push(Schema.decodeUnknownSync(CompetitorJson)(cached));
    }
    return reports;
  }).pipe(Effect.mapError(fail("competitors")));

  const competitorFetch = Effect.fn("Analytics.competitorFetch")(
    function* (h: string) {
      const purpose = "analyze.competitors";
      const profile = yield* x.profile(h, purpose);
      const posts = yield* userPosts(h, 1, purpose);
      const report: CompetitorReport = {
        handle: h,
        fetchedAt: yield* nowIso,
        profile,
        avgViews: avgViews(posts),
        topPosts: [...posts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5),
      };
      yield* store.cacheSet(
        `competitor:${h}`,
        Schema.encodeSync(CompetitorJson)(report),
        report.fetchedAt,
      );
      return report;
    },
    Effect.mapError(fail("competitorFetch")),
  );

  const ask = Effect.fn("Analytics.ask")(
    function* (question: string) {
      const d = yield* data;
      const best = yield* bestPosts;
      return yield* assist.generate({
        task: "analyze.ask",
        instructions:
          "Answer the user's question about their X account using only the data given. Be concrete and cite numbers. Then suggest up to 3 short follow-up questions they could ask next.",
        input: {
          question,
          handle: d.handle,
          posts: d.posts.length,
          followers: d.snapshots.at(-1)?.followers ?? null,
          avgViews: avgViews(d.posts),
          bestPosts: best.slice(0, 15).map((p) => ({
            text: p.text,
            kind: p.kind,
            views: p.views,
            likes: p.likes,
            replies: p.replies,
            createdAt: p.createdAt,
          })),
          byKind: (["text", "media", "link", "reply", "thread"] as const).map((kind) => ({
            kind,
            posts: d.posts.filter((p) => p.kind === kind).length,
            avgViews: avgViews(d.posts.filter((p) => p.kind === kind)),
          })),
        },
        output: AskAnswer,
      });
    },
    Effect.mapError(fail("ask")),
  );

  return Analytics.of({ data, refresh, engagers, themes, competitors, competitorFetch, ask });
});

export const layer = Layer.effect(Analytics, make);

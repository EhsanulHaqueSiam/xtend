import {
  type AccountPost,
  type AnalyzeData,
  type AnalyzeWindow,
  AnalyzeError,
  AskAnswer,
  CompetitorReport,
  type Engager,
  type HeatmapCell,
  type ObservedPostSummary,
  type PostStripEntry,
  Theme,
  type XPost,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import { observedToPost } from "../engage/inbox.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as ScoreStore from "../scores/ScoreStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as AnalyticsStore from "./AnalyticsStore.ts";
import * as PostAnalytics from "./PostAnalytics.ts";

/** Pages of own posts one refresh reads; Costs prices a refresh from it. */
export const POST_PAGES = 5;
const MAX_POSTS = 100;

const ThemesJson = Schema.fromJsonString(Schema.Array(Theme));
const CompetitorJson = Schema.fromJsonString(CompetitorReport);
const decodeThemesJson = Schema.decodeUnknownSync(ThemesJson);
const decodeCompetitorJson = Schema.decodeUnknownSync(CompetitorJson);
const encodeThemesJson = Schema.encodeSync(ThemesJson);
const encodeCompetitorJson = Schema.encodeSync(CompetitorJson);

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

/**
 * The account's posts: what the last Refresh read, joined by what the session saw since, free.
 * A sighting newer than the Refresh carries fresher numbers; reposts are someone else's post.
 */
export const withSeen = (
  stored: ReadonlyArray<AccountPost>,
  fetchedAt: string | null,
  seen: ReadonlyArray<ObservedPostSummary>,
): ReadonlyArray<AccountPost> => {
  const byId = new Map(stored.map((p) => [p.postId, p]));
  for (const o of seen) {
    if (o.isRepost) continue;
    const prev = byId.get(o.postId);
    if (prev === undefined || fetchedAt === null || o.lastSeenAt > fetchedAt)
      byId.set(o.postId, { ...prev, ...toAccountPost(observedToPost(o)) });
  }
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_POSTS);
};

const DAY_MS = 86_400_000;
const engagements = (p: AccountPost) => p.likes + p.reposts + p.replies + p.quotes + p.bookmarks;
const engagementRate = (p: AccountPost): number =>
  p.views === null || p.views === 0 ? 0 : engagements(p) / p.views;

// A post X gave no view count is left out of every per-view figure: its engagements over zero
// views would inflate a rate, and counting it as zero views would drag an average down.
const withViews = (posts: ReadonlyArray<AccountPost>) => posts.filter((p) => p.views !== null);
const sumViews = (posts: ReadonlyArray<AccountPost>) =>
  posts.reduce((s, p) => s + (p.views ?? 0), 0);

const windowOf = (posts: ReadonlyArray<AccountPost>, days: number): AnalyzeWindow => {
  const views = sumViews(posts);
  return {
    days,
    posts: posts.length,
    views,
    likes: posts.reduce((s, p) => s + p.likes, 0),
    replies: posts.reduce((s, p) => s + p.replies, 0),
    reposts: posts.reduce((s, p) => s + p.reposts, 0),
    engagementRate:
      views === 0 ? 0 : withViews(posts).reduce((s, p) => s + engagements(p), 0) / views,
  };
};

/** Everything the Overview shows, computed once here so every client agrees. Post days are the account's. */
export const summarize = (
  posts: ReadonlyArray<AccountPost>,
  snapshots: ReadonlyArray<AnalyzeData["snapshots"][number]>,
  nowMs: number,
  zone: DateTime.TimeZone,
): Pick<AnalyzeData, "windows" | "viewsByPostDay" | "followerDelta30d"> => {
  const within = (days: number) =>
    posts.filter((p) => nowMs - Date.parse(p.createdAt) < days * DAY_MS);
  const byDay = new Map<string, { posts: number; views: number }>();
  for (const p of within(30)) {
    const day = DateTime.formatIsoDate(DateTime.setZone(DateTime.makeUnsafe(p.createdAt), zone));
    const cell = byDay.get(day) ?? { posts: 0, views: 0 };
    byDay.set(day, { posts: cell.posts + 1, views: cell.views + (p.views ?? 0) });
  }
  const latest = snapshots.at(-1);
  const cutoff = DateTime.formatIsoDate(DateTime.makeUnsafe(nowMs - 30 * DAY_MS));
  const earlier = snapshots.toReversed().find((s) => s.day <= cutoff);
  return {
    windows: [windowOf(within(7), 7), windowOf(within(30), 30)],
    viewsByPostDay: [...byDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, c]) => ({ day, posts: c.posts, views: c.views })),
    followerDelta30d:
      latest === undefined || earlier === undefined
        ? null
        : { delta: latest.followers - earlier.followers, sinceDay: earlier.day },
  };
};

const avgViews = (posts: ReadonlyArray<AccountPost>) => {
  const viewed = withViews(posts);
  return viewed.length === 0 ? 0 : sumViews(viewed) / viewed.length;
};

/** Hour-of-week cells with at least one post, in the account's zone; the UI fills the empty ones. */
export const heatmapOf = (
  posts: ReadonlyArray<AccountPost>,
  zone: DateTime.TimeZone,
): ReadonlyArray<HeatmapCell> => {
  const cells = new Map<number, Array<AccountPost>>();
  for (const p of posts) {
    const d = DateTime.toParts(DateTime.setZone(DateTime.makeUnsafe(p.createdAt), zone));
    const key = d.weekDay * 24 + d.hour;
    cells.set(key, [...(cells.get(key) ?? []), p]);
  }
  return [...cells].map(([key, cell]) => ({
    weekday: Math.floor(key / 24),
    hour: key % 24,
    posts: cell.length,
    avgViews: avgViews(cell),
  }));
};

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
    /** Paid: X's private metrics for the last 30 days of own posts, then `data`. */
    readonly refreshNonPublic: Effect.Effect<AnalyzeData, AnalyzeError>;
    /** Turns the nightly private-metrics read on or off, then `data`. */
    readonly nightlySet: (on: boolean) => Effect.Effect<AnalyzeData, AnalyzeError>;
    /** The overlay's own-post strip; posts without a stored analytics row are left out. */
    readonly postStrip: (
      postIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<PostStripEntry>, AnalyzeError>;
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
  const postAnalytics = yield* PostAnalytics.PostAnalytics;
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const current = settings.get.pipe(Effect.mapError(fail("settings")));
  const handle = Effect.map(current, (s) => s.handle);
  const requireHandle = Effect.flatMap(handle, (h) =>
    h === null
      ? Effect.fail(
          new AnalyzeError({
            operation: "handle",
            detail: "no X handle yet; it comes from your X session, or set it in Settings",
          }),
        )
      : Effect.succeed(h),
  );

  const userPosts = Effect.fn("Analytics.userPosts")(function* (
    h: string,
    pages: number,
    purpose: string,
  ) {
    const posts: Array<AccountPost> = [];
    let cursor: string | null = null;
    for (let page = 0; page < pages && posts.length < MAX_POSTS; page++) {
      const result: XClient.Page<XPost> = yield* x.userPosts(h, {
        purpose,
        ...(cursor === null ? {} : { cursor }),
      });
      // Reposts are someone else's post wearing this handle; they are not the account's performance.
      posts.push(...result.items.filter((p) => !p.isRepost).map(toAccountPost));
      cursor = result.nextCursor;
      if (cursor === null) break;
    }
    return posts.slice(0, MAX_POSTS);
  });

  const data: Effect.Effect<AnalyzeData, AnalyzeError> = Effect.gen(function* () {
    const { handle: h, timeZone } = yield* current;
    const zone = SettingsStore.zoneOf(timeZone);
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const nonPublic = yield* postAnalytics.current;
    if (h === null)
      return {
        handle: null,
        avatarUrl: null,
        fetchedAt: null,
        posts: [],
        snapshots: [],
        heatmap: [],
        timeZone,
        ...summarize([], [], nowMs, zone),
        nonPublic,
      };
    const stored = yield* store.listPosts(h);
    const seen = yield* observations
      .listRecent({ authorHandle: h, limit: 200 })
      .pipe(Effect.orElseSucceed(() => ({ posts: [] })));
    const posts = withSeen(stored.posts, stored.fetchedAt, seen.posts);
    const { fetchedAt } = stored;
    const snapshots = yield* store.listSnapshots(h);
    const { avatarUrl } = yield* scoreStore.profileHistory(h).pipe(Effect.mapError(fail("data")));
    return {
      handle: h,
      avatarUrl,
      fetchedAt,
      posts,
      snapshots,
      heatmap: heatmapOf(posts, zone),
      timeZone,
      ...summarize(posts, snapshots, nowMs, zone),
      nonPublic,
    };
  });

  const refresh = Effect.gen(function* () {
    const h = yield* requireHandle;
    const profile = yield* x.profile(h, "analyze.refresh");
    const at = yield* nowIso;
    if (profile !== null) yield* scoreStore.saveProfile(profile, at.slice(0, 10));
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
    if (cached !== null) return decodeThemesJson(cached);
    const result = yield* assist.generate({
      task: "analyze.themes",
      instructions:
        "These are the user's best performing posts by engagement rate. Group them into exactly 5 themes. For each theme give a short name, the ids of the posts that belong to it, and one sentence on why that theme works for this account.",
      input: best.map((p) => ({ id: p.postId, text: p.text, views: p.views, likes: p.likes })),
      output: Schema.Array(Theme),
    });
    yield* store.cacheSet(key, encodeThemesJson(result), yield* nowIso);
    return result;
  }).pipe(Effect.mapError(fail("themes")));

  const competitors = Effect.gen(function* () {
    const watched = yield* scoreStore.watchList;
    const reports: Array<CompetitorReport> = [];
    for (const w of watched) {
      const cached = yield* store.cacheGet(`competitor:${w.handle}`);
      if (cached !== null) reports.push(decodeCompetitorJson(cached));
    }
    return reports;
  }).pipe(Effect.mapError(fail("competitors")));

  const competitorFetch = Effect.fn("Analytics.competitorFetch")(
    function* (input: string) {
      const h = input.toLowerCase();
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
      yield* store.cacheSet(`competitor:${h}`, encodeCompetitorJson(report), report.fetchedAt);
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

  const refreshNonPublic = Effect.andThen(postAnalytics.refresh, data);
  const nightlySet = (on: boolean) => Effect.andThen(postAnalytics.setNightly(on), data);

  const postStrip = Effect.fn("Analytics.postStrip")(function* (postIds: ReadonlyArray<string>) {
    const { byPost } = yield* postAnalytics.current;
    const mean =
      byPost.length === 0 ? null : byPost.reduce((s, r) => s + r.impressions, 0) / byPost.length;
    const wanted = new Set(postIds);
    return byPost
      .filter((r) => wanted.has(r.postId))
      .map((r): PostStripEntry => ({
        postId: r.postId,
        impressions: r.impressions,
        er: r.impressions === 0 ? 0 : (r.likes + r.replies + r.reposts) / r.impressions,
        profileVisits: r.profileVisits,
        follows: r.follows,
        vsAverage: mean === null || mean === 0 ? null : r.impressions / mean,
      }));
  });

  return Analytics.of({
    data,
    refresh,
    engagers,
    themes,
    competitors,
    competitorFetch,
    ask,
    refreshNonPublic,
    nightlySet,
    postStrip,
  });
});

export const layer = Layer.effect(Analytics, make);

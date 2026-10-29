/**
 * A deterministic, realistic database for benchmarks and payload budgets: what one heavy user's
 * install holds after three months (SIZES.days) of daily use, written through the real stores.
 *
 * - Observations: 20,000 posts from 3,000 authors, each seen twice (~40,000 metrics rows). About
 *   220 new posts a day: a long daily scroll of Home plus profiles and searches.
 * - Leads: 1,000 people over 5 lists, one in eight contacted (stage change plus a note).
 * - Compose: 300 drafts, three or four a day: 210 posted, 30 queued, 30 drafts, 15 failed, 15
 *   suggested. 15 are 6 KB articles (10 posted, 5 unfinished); every 5th thread carries images.
 * - Automate: 50 rules with 2,000 runs, busy rules running most.
 * - Analyze: 100 own posts (what one refresh keeps: Analytics' MAX_POSTS, and replacePosts swaps
 *   the whole set), a profile snapshot a day, and the nightly private-metrics job opted in for all
 *   90 nights (rows for every own post of the last 30 days, four posts a day).
 * - Library: 9,000 archived search results (five searches a day), the daily picks for the last 30
 *   days (3,000, each mirrored into Staff picks) and 450 posts saved by hand, most into 4
 *   collections.
 * - Read cache: the Engage screen's reads made ten minutes before SEED_NOW (a search per keyword,
 *   the own timeline, the connected account), through Treg.call against canned treg answers, so
 *   cost quotes probe warm rows the way they do right after a screen loads.
 *
 * Every "now" the seeded service reads is SEED_NOW, so time windows (Analyze's 7 and 30 days, a
 * rule's day) come out the same on every run. Nothing reaches the network or a model.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  AccountPost,
  Candidate,
  ObservedPost,
  RuleInput,
  XFollower,
  XPost,
} from "@xtend/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Assist from "../ai/Assist.ts";
import * as Analytics from "../analyze/Analytics.ts";
import * as AnalyticsStore from "../analyze/AnalyticsStore.ts";
import * as PostAnalytics from "../analyze/PostAnalytics.ts";
import * as RuleStore from "../automate/RuleStore.ts";
import * as Budget from "../budget/Budget.ts";
import * as DraftStore from "../compose/DraftStore.ts";
import * as Costs from "../costs/Costs.ts";
import * as Events from "../events/Events.ts";
import * as PeopleStore from "../leads/PeopleStore.ts";
import * as LibraryStore from "../library/LibraryStore.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ScoreStore from "../scores/ScoreStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "../x/Treg.ts";
import * as XClient from "../x/XClient.ts";

export const SIZES = {
  days: 90,
  observedPosts: 20_000,
  authors: 3_000,
  people: 1_000,
  drafts: 300,
  rules: 50,
  ruleRuns: 2_000,
  ownPostsPerDay: 4,
  ownPostsKept: 100,
  searchesPerDay: 5,
  pickDays: 30,
  savesPerDay: 5,
} as const;

/** One observation batch carries this many new posts and as many re-sightings of the batch before. */
const FRESH_PER_BATCH = 50;
const PAGE = 20;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const SEED_NOW = Date.parse("2026-10-28T12:00:00.000Z");
const START = SEED_NOW - SIZES.days * DAY_MS;
export const HANDLE = "siam";
const TIME_ZONE = "America/New_York";
const KEYWORDS = ["indie hacking", "saas growth", "ai agents", "build in public", "solo founder"];

/** mulberry32: the same seed gives the same sequence on every machine. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
type Rng = ReturnType<typeof rng>;

const WORDS = (
  "ship build launch users growth revenue founder product design code agents startup market " +
  "thread lesson mistake learned today week year team hire funding pricing churn retention " +
  "onboarding feedback distribution audience writing content simple small bold idea problem " +
  "customer nobody everyone shipped tiny bootstrapped profitable workflow"
).split(" ");

const pick = <A>(r: Rng, items: ReadonlyArray<A>): A => items[Math.floor(r() * items.length)]!;
/** Words until the text reaches a length between min and max, like a real post. */
const text = (r: Rng, min: number, max: number) => {
  const target = min + Math.floor(r() * (max - min));
  let out = pick(r, WORDS);
  while (out.length < target) out += ` ${pick(r, WORDS)}`;
  return out;
};
const title = (r: Rng) => {
  const name = text(r, 8, 18);
  return name.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
};
/** Reach on a log scale: most accounts are small, a few are huge. */
const reach = (r: Rng, minExp: number, maxExp: number) =>
  Math.round(10 ** (minExp + (maxExp - minExp) * r()));
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const isoDay = (ms: number) => iso(ms).slice(0, 10);
/** X ids are 19-digit snowflakes; every kind of row gets its own prefix so ids never collide. */
const xId = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(19 - prefix.length, "0")}`;

const author = (i: number) => {
  const r = rng(1_000_000 + i);
  return {
    userId: xId("9", i),
    handle: `${pick(r, WORDS).slice(0, 10)}${i}`,
    name: title(r),
    followers: reach(r, 2, 6),
    verified: r() < 0.2,
  };
};

/** When post n of the observed stream is first seen; the stream fills SIZES.days evenly. */
const observedAtOf = (n: number) =>
  START +
  Math.floor(n / FRESH_PER_BATCH) *
    ((SIZES.days * DAY_MS) / (SIZES.observedPosts / FRESH_PER_BATCH));

/**
 * Post n as the desktop observes it on its `sighting`-th look (0 first). Ids past
 * SIZES.observedPosts are posts the seed never wrote, for benchmarks that record new ones.
 */
export const observedPost = (n: number, sighting = 0): ObservedPost => {
  const r = rng(n);
  const views = reach(r, 2, 6);
  const grow = (count: number) => Math.round(count * (1 + 0.5 * sighting));
  // Popular authors show up far more often than the long tail.
  const a = author(Math.floor(SIZES.authors * r() ** 2));
  const long = r() < 0.05;
  return {
    postId: xId("18", n),
    author: a,
    text: long ? text(r, 600, 2_000) : text(r, 30, 280),
    createdAt: iso(observedAtOf(n) - r() * 12 * HOUR_MS),
    isReply: r() < 0.15,
    isRepost: r() < 0.05,
    isPromoted: r() < 0.02,
    hasMedia: r() < 0.35,
    hasLink: r() < 0.15,
    metrics: {
      views: r() < 0.03 ? null : grow(views),
      likes: grow(Math.round(views * 0.02 * r())),
      reposts: grow(Math.round(views * 0.003 * r())),
      replies: grow(Math.round(views * 0.002 * r())),
      quotes: grow(Math.round(views * 0.0005 * r())),
      bookmarks: grow(Math.round(views * 0.004 * r())),
    },
  };
};

/** A post as search, picks and saves see it; n spaces are disjoint per source. */
const xPost = (n: number, at: number): XPost => {
  const r = rng(5_000_000 + n);
  const a = author(Math.floor(SIZES.authors * r()));
  const views = reach(r, 3, 7);
  return {
    postId: xId("17", n),
    url: `https://x.com/${a.handle}/status/${xId("17", n)}`,
    text: text(r, 60, 280),
    createdAt: iso(at - r() * 5 * DAY_MS),
    lang: r() < 0.9 ? "en" : "es",
    isReply: false,
    isRepost: false,
    hasMedia: r() < 0.4,
    hasLink: r() < 0.2,
    author: {
      ...a,
      avatarUrl: `https://pbs.twimg.com/profile_images/${xId("16", n)}/${a.handle}_normal.jpg`,
    },
    metrics: {
      views,
      likes: Math.round(views * 0.03 * r()),
      reposts: Math.round(views * 0.004 * r()),
      replies: Math.round(views * 0.002 * r()),
      quotes: Math.round(views * 0.0005 * r()),
      bookmarks: Math.round(views * 0.006 * r()),
    },
  };
};

const candidate = (i: number): Candidate => {
  const r = rng(2_000_000 + i);
  return {
    handle: `${pick(r, WORDS).slice(0, 9)}_${i}`,
    name: title(r),
    userId: r() < 0.7 ? xId("8", i) : null,
    followers: reach(r, 2, 5),
    bio: text(r, 60, 160),
  };
};

/**
 * Follower i of the seeded account as a score run reads one: mostly small accounts, one in ten
 * a follow-everyone bot, some blank or under a year old, a few funds.
 */
export const follower = (i: number): XFollower => {
  const r = rng(9_000_000 + i);
  const followers = reach(r, 0, 5.5);
  const roll = r();
  return {
    userId: xId("7", i),
    handle: `${pick(r, WORDS).slice(0, 10)}_${i}`,
    name: title(r),
    followers,
    following:
      roll < 0.1 ? 2_000 + Math.floor(r() * 5_000) : Math.floor(followers * (0.2 + 2 * r())),
    verified: r() < 0.08,
    bio:
      roll > 0.85
        ? ""
        : roll > 0.82
          ? "Partner at Acme Ventures. Investing in devtools."
          : text(r, 20, 160),
    createdAt: iso(SEED_NOW - r() * 12 * 365 * DAY_MS),
  };
};

/** Own post k: four a day across the seeded months, oldest first. */
const ownPost = (k: number): AccountPost => {
  const r = rng(3_000_000 + k);
  const views = reach(r, 3, 5);
  return {
    postId: xId("19", k),
    url: `https://x.com/${HANDLE}/status/${xId("19", k)}`,
    text: text(r, 40, 280),
    createdAt: iso(
      START +
        Math.floor(k / SIZES.ownPostsPerDay) * DAY_MS +
        (k % SIZES.ownPostsPerDay) * 4 * HOUR_MS +
        8 * HOUR_MS,
    ),
    kind: pick(r, ["text", "media", "link", "reply", "thread"] as const),
    views,
    likes: Math.round(views * 0.02 * r()),
    reposts: Math.round(views * 0.003 * r()),
    replies: Math.round(views * 0.003 * r()),
    quotes: Math.round(views * 0.0005 * r()),
    bookmarks: Math.round(views * 0.004 * r()),
  };
};

const ruleShapes = (listId: number): ReadonlyArray<Pick<RuleInput, "trigger" | "action">> => [
  {
    trigger: { kind: "post_crosses_threshold", metric: "views", threshold: 10_000 },
    action: {
      kind: "auto_plug",
      text: "I write about shipping small products every week: https://example.com/newsletter",
    },
  },
  {
    trigger: { kind: "new_engager" },
    action: {
      kind: "auto_dm",
      template: "Hey {name}, thanks for the like! Building anything right now?",
    },
  },
  {
    trigger: { kind: "keyword_post", query: "indie hacker launch" },
    action: { kind: "auto_like" },
  },
  {
    trigger: { kind: "schedule", weekdays: [1, 3, 5], time: "09:30" },
    action: { kind: "auto_retweet", evergreen: true },
  },
  { trigger: { kind: "new_follower" }, action: { kind: "notify", message: "{name} followed you" } },
  { trigger: { kind: "agent_match", minScore: 70 }, action: { kind: "add_to_list", listId } },
  {
    trigger: { kind: "post_engaged", postId: xId("19", 7), via: "repost" },
    action: { kind: "follow" },
  },
  {
    trigger: { kind: "schedule", weekdays: [0], time: "18:00" },
    action: { kind: "auto_delete", olderThanDays: 30, maxViews: 200 },
  },
];

/** The [from, to) slice of `total` items that falls on `day` when spread evenly over SIZES.days. */
const onDay = (total: number, day: number) =>
  [Math.floor((day * total) / SIZES.days), Math.floor(((day + 1) * total) / SIZES.days)] as const;

const ARTICLE_BODY = (r: Rng) =>
  Array.from({ length: 12 }, () => `## ${title(r)}\n\n${text(r, 380, 520)}`).join("\n\n");

const seedObservations = Effect.gen(function* () {
  const observations = yield* ObservationStore.ObservationStore;
  const batches = SIZES.observedPosts / FRESH_PER_BATCH;
  for (let b = 0; b < batches; b++) {
    const fresh = Array.from({ length: FRESH_PER_BATCH }, (_, i) =>
      observedPost(b * FRESH_PER_BATCH + i),
    );
    // The batch before, seen again with grown counts: each post gets two metrics rows.
    const again =
      b === 0
        ? []
        : Array.from({ length: FRESH_PER_BATCH }, (_, i) =>
            observedPost((b - 1) * FRESH_PER_BATCH + i, 1),
          );
    yield* observations.record({
      viewerHandle: HANDLE,
      accountId: 1,
      source: b % 5 === 0 ? "profile" : b % 7 === 0 ? "search" : "home",
      observedAt: iso(observedAtOf(b * FRESH_PER_BATCH) + HOUR_MS),
      posts: [...fresh, ...again],
    });
  }
});

const seedDays = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* SettingsStore.SettingsStore;
  const people = yield* PeopleStore.PeopleStore;
  const drafts = yield* DraftStore.DraftStore;
  const rules = yield* RuleStore.RuleStore;
  const scores = yield* ScoreStore.ScoreStore;
  const library = yield* LibraryStore.LibraryStore;

  yield* TestClock.setTime(START);
  // A stored token keeps Treg from reading the developer's own ~/.treg/config.json.
  yield* settings.update({
    handle: HANDLE,
    timeZone: TIME_ZONE,
    keywords: KEYWORDS,
    dailyLibraryJobs: true,
    tregToken: "seed-token",
  });
  const lists = yield* Effect.forEach(
    ["Founders", "Investors", "Designers", "Agencies", "Podcasts"],
    (name) => people.createList(name),
  );
  const collections = yield* Effect.forEach(
    ["Hooks", "Threads to study", "Launch posts", "Pricing"],
    (name) => library.collectionCreate(name),
  );
  const shapes = ruleShapes(lists[0]!.id);
  const ruleIds = yield* Effect.forEach(
    Array.from({ length: SIZES.rules }, (_, i) => i),
    (i) =>
      Effect.map(
        rules.upsert({
          ...shapes[i % shapes.length]!,
          name: `${title(rng(4_000_000 + i))} ${i}`,
          enabled: i % 6 !== 0,
          conditions:
            i % 3 === 0 ? { withinHours: 24, notReply: true } : { minAuthorFollowers: 1_000 },
          waitMinutes: i % 4 === 0 ? 30 : 0,
          budgetUsdDay: 0.5,
          budgetUsdMonth: 10,
          undoAfterHours: i % 5 === 0 ? 48 : null,
          askFirst: i % 7 === 0,
          dryRun: i % 9 === 0,
        }),
        (rule) => rule.id,
      ),
  );

  for (let day = 0; day < SIZES.days; day++) {
    const dayStart = START + day * DAY_MS;
    const r = rng(6_000_000 + day);
    yield* TestClock.setTime(dayStart + 9 * HOUR_MS);

    // Leads: a list search's worth of people, a few of them contacted.
    const [p0, p1] = onDay(SIZES.people, day);
    const list = lists[day % lists.length]!;
    const ids = yield* people.addMany(
      Array.from({ length: p1 - p0 }, (_, i) => candidate(p0 + i)),
      `list:${list.name}`,
      list.id,
    );
    for (const [i, id] of ids.entries()) {
      if (id === null || (p0 + i) % 8 !== 0) continue;
      yield* people.update({
        id,
        stage: (p0 + i) % 24 === 0 ? "replied" : "contacted",
        notes: "Sent a DM about the beta; follow up next week if no answer.",
      });
    }

    // Compose: a few drafts, most of them posted.
    const [d0, d1] = onDay(SIZES.drafts, day);
    for (let i = d0; i < d1; i++) {
      const dr = rng(7_000_000 + i);
      const article = i % 30 === 3 || i % 60 === 8;
      const draft = yield* drafts.create(
        article
          ? { kind: "article", title: title(dr), body: ARTICLE_BODY(dr), blocks: [] }
          : {
              blocks: Array.from({ length: 1 + Math.floor(dr() * 5) }, () => ({
                text: text(dr, 80, 270),
              })),
              ...(i % 10 === 9 && i % 20 !== 9
                ? {
                    status: "suggested" as const,
                    source: `https://x.com/${HANDLE}/status/${xId("17", i)}`,
                  }
                : {}),
            },
      );
      if (!article && i % 5 === 0)
        for (let m = 0; m < 1 + (i % 2); m++)
          yield* drafts.mediaInsert(draft.id, {
            id: `${draft.id.slice(0, 8)}-${m}`,
            blockIndex: 0,
            path: `/Users/someone/.xtend/media/${draft.id}/${m}.jpg`,
            kind: "image",
            alt: text(dr, 20, 80),
          });
      const slot = i % 10;
      if (slot <= 6)
        yield* drafts.setOutcome(draft.id, {
          status: "posted",
          // An article posts as one post plus its article id, as Publisher records it.
          ...(article
            ? { postIds: [xId("15", i * 10)], articleId: xId("14", i) }
            : { postIds: draft.blocks.map((_, k) => xId("15", i * 10 + k)) }),
          postedAt: iso(dayStart + 10 * HOUR_MS),
          attempts: 1,
        });
      else if (slot === 7)
        yield* drafts.setOutcome(draft.id, {
          status: "queued",
          scheduledAt: iso(SEED_NOW + (i % 14) * 6 * HOUR_MS),
        });
      else if (slot === 9 && i % 20 === 9)
        yield* drafts.setOutcome(draft.id, {
          status: "failed",
          error: "X said 403: You are not allowed to create a Tweet with duplicate content.",
          attempts: 3,
        });
    }

    // Automate: the day's runs, the busy rules most.
    const [r0, r1] = onDay(SIZES.ruleRuns, day);
    for (let i = r0; i < r1; i++) {
      const roll = r();
      const ruleId = ruleIds[Math.floor(SIZES.rules * r() ** 2)]!;
      const subject = xId("18", Math.floor(r() * SIZES.observedPosts));
      const status =
        roll < 0.5
          ? "ok"
          : roll < 0.75
            ? "skipped"
            : roll < 0.85
              ? "dry_run"
              : roll < 0.95
                ? "failed"
                : "pending";
      yield* rules.recordRun({
        ruleId,
        subjectId: `${subject}-${i}`,
        status,
        detail:
          status === "ok"
            ? `liked ${subject} by @${author(i % SIZES.authors).handle} (${reach(r, 3, 6)} views)`
            : status === "skipped"
              ? "author has fewer than 1,000 followers"
              : status === "failed"
                ? "X said 429: Too Many Requests"
                : status === "dry_run"
                  ? `would like ${subject}`
                  : "waiting for your approval",
        costUsd: status === "ok" || status === "dry_run" ? 0.015 : 0,
        xId: status === "ok" ? subject : null,
      });
    }

    // Analyze: today's profile snapshot; the name and bio change twice in three months.
    const era = Math.floor((day * 3) / SIZES.days);
    yield* scores.saveProfile(
      {
        userId: "1234567",
        handle: HANDLE,
        name: ["Siam", "Siam | building Xtend", "Siam (shipping)"][era]!,
        bio: text(rng(8_000_000 + era), 80, 160),
        followers: 4_000 + day * 30 + Math.floor(r() * 20),
        following: 800 + Math.floor(day / 3),
        posts: 9_000 + day * SIZES.ownPostsPerDay,
        verified: true,
        avatarUrl: `https://pbs.twimg.com/profile_images/${xId("16", era)}/avatar_normal.jpg`,
        createdAt: "2015-03-01T00:00:00.000Z",
        location: "Dhaka",
        website: "https://example.com",
      },
      isoDay(dayStart),
    );
    // The nightly private-metrics job: one row per own post of the last 30 days. Only a paid treg
    // call writes these, so the seed inserts them as that job would.
    const firstOwn = Math.max(0, (day - 29) * SIZES.ownPostsPerDay);
    const rows = Array.from({ length: (day + 1) * SIZES.ownPostsPerDay - firstOwn }, (_, j) => {
      const k = firstOwn + j;
      const impressions = Math.round(
        reach(rng(3_000_000 + k), 3, 5) * Math.min(1, (day + 1 - k / 4) / 7),
      );
      return {
        post_id: xId("19", k),
        day: isoDay(dayStart),
        impressions,
        profile_visits: Math.round(impressions * 0.004),
        link_clicks: Math.round(impressions * 0.002),
        follows: Math.round(impressions * 0.0005),
        likes: Math.round(impressions * 0.02),
        replies: Math.round(impressions * 0.003),
        reposts: Math.round(impressions * 0.003),
      };
    });
    yield* sql`INSERT INTO post_analytics ${sql.insert(rows)}`;
    yield* sql`
      INSERT INTO post_analytics_runs (at, posts, error, manual)
      VALUES (${iso(dayStart + 7 * HOUR_MS)}, ${rows.length}, ${null}, ${day === 0 ? 1 : 0})
    `;

    // Library: the day's searches land in the archive, picks once opted in, and a few saves.
    for (let s = 0; s < SIZES.searchesPerDay; s++)
      yield* library.upsertPosts(
        Array.from({ length: PAGE }, (_, j) =>
          xPost((day * SIZES.searchesPerDay + s) * PAGE + j, dayStart),
        ),
      );
    if (day >= SIZES.days - SIZES.pickDays)
      for (const [k, keyword] of KEYWORDS.entries()) {
        const posts = Array.from({ length: PAGE }, (_, j) =>
          xPost(1_000_000 + (day * KEYWORDS.length + k) * PAGE + j, dayStart),
        );
        yield* library.picksRecord({ day: isoDay(dayStart), keyword, posts });
        yield* library.upsertPosts(posts);
      }
    for (let s = 0; s < SIZES.savesPerDay; s++)
      yield* library.save({
        post: xPost((day * SIZES.searchesPerDay + s) * PAGE, dayStart),
        collectionId: s < collections.length ? collections[s]!.id : null,
        note: s % 2 === 0 ? "Great hook; reuse the structure for the launch thread." : "",
      });
  }

  // Analyze keeps the newest refresh: the last ownPostsKept own posts.
  yield* TestClock.setTime(SEED_NOW - HOUR_MS);
  const owned = SIZES.days * SIZES.ownPostsPerDay;
  yield* (yield* AnalyticsStore.AnalyticsStore).replacePosts(
    HANDLE,
    Array.from({ length: SIZES.ownPostsKept }, (_, j) => ownPost(owned - 1 - j)),
    iso(SEED_NOW - HOUR_MS),
  );

  // The Engage screen loaded ten minutes ago: its reads sit warm in the read cache.
  yield* TestClock.setTime(SEED_NOW - 10 * 60_000);
  const x = yield* XClient.XClient;
  for (const keyword of KEYWORDS)
    yield* x.searchPosts(keyword, { mode: "latest", purpose: "engage.targets" });
  yield* x.userPosts(HANDLE, { purpose: "engage.findKeywords" });
  yield* x.me("engage.like");
});

/** A post in the scraper's shape, as treg relays it. */
const anyapiRow = (n: number) => {
  const p = xPost(n, SEED_NOW);
  return {
    id: p.postId,
    url: p.url,
    text: p.text,
    createdUtc: Math.floor(Date.parse(p.createdAt) / 1000),
    lang: p.lang,
    isReply: p.isReply,
    media: p.hasMedia
      ? [{ type: "photo", url: `https://pbs.twimg.com/media/${p.postId}.jpg` }]
      : [],
    authorId: p.author.userId,
    authorUsername: p.author.handle,
    authorName: p.author.name,
    authorFollowers: p.author.followers,
    authorVerified: p.author.verified,
    authorImage: p.author.avatarUrl,
    viewCount: p.metrics.views,
    likeCount: p.metrics.likes,
    retweetCount: p.metrics.reposts,
    replyCount: p.metrics.replies,
    quoteCount: p.metrics.quotes,
    bookmarkCount: p.metrics.bookmarks,
  };
};

// treg's answers to the reads the seed makes, by endpoint; any other call is a seed bug.
const layerCannedTreg = Layer.sync(HttpClient.HttpClient)(() => {
  let served = 0;
  const page = () => Array.from({ length: PAGE }, () => anyapiRow(2_000_000 + served++));
  const canned: Record<string, () => unknown> = {
    "anyapi.x.search.posts": () => ({ output: { data: { items: page(), nextCursor: "next" } } }),
    "anyapi.x.user.posts.timeline": () => ({
      output: { data: { tweets: page(), nextCursor: "next" } },
    }),
    "x/2/users/me": () => ({ data: { id: "1234567", name: "Siam", username: HANDLE } }),
  };
  return HttpClient.make((request) => {
    const answer = canned[new URL(request.url).pathname.replace("/call/", "")];
    return answer === undefined
      ? Effect.die(`no network in a seeded service: ${request.url}`)
      : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(answer()))));
  });
});

const frozenNanos = BigInt(SEED_NOW) * 1_000_000n;
// Frozen at SEED_NOW. Nothing sleeps: PostAnalytics' nightly loop runs its first tick (08:00 in
// TIME_ZONE, not its hour) and never wakes again.
const layerClock = Layer.succeed(Clock.Clock)({
  currentTimeMillisUnsafe: () => SEED_NOW,
  currentTimeMillis: Effect.succeed(SEED_NOW),
  currentTimeNanosUnsafe: () => frozenNanos,
  currentTimeNanos: Effect.succeed(frozenNanos),
  monotonicTimeNanosUnsafe: () => process.hrtime.bigint(),
  monotonicTimeNanos: Effect.sync(() => process.hrtime.bigint()),
  sleep: () => Effect.never,
});

const layerBase = Layer.mergeAll(
  Sqlite.layerMemory,
  TokenCipher.layerTest,
  Events.layer,
  NodeServices.layer,
  layerClock,
  Layer.succeed(Assist.Assist)({ generate: () => Effect.die("no model in a seeded service") }),
  layerCannedTreg,
);

const layerStores = Layer.mergeAll(
  ObservationStore.layer,
  PeopleStore.layer,
  DraftStore.layer,
  RuleStore.layer,
  AnalyticsStore.layer,
  ScoreStore.layer,
  LibraryStore.layer,
  XClient.layer,
).pipe(
  Layer.provideMerge(Treg.layer),
  Layer.provideMerge(Budget.layer),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(layerBase),
);

// Seeding moves its own clock day by day so every row carries a realistic time.
const layerSeeded = Layer.effectDiscard(
  Effect.andThen(seedObservations, seedDays).pipe(Effect.provide(TestClock.layer())),
).pipe(Layer.provideMerge(layerStores));

/** The stores plus the services list screens and quotes call, over the seeded database. */
export const layer = Layer.mergeAll(Analytics.layer, Costs.layer).pipe(
  Layer.provideMerge(PostAnalytics.layer),
  Layer.provideMerge(layerSeeded),
);

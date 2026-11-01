import {
  Action,
  actionCostUsd,
  AutomateError,
  type Conditions,
  type DryRunReport,
  type LeadsError,
  type ObservationStoreError,
  type PendingPreview,
  type Rule,
  type RulePreview,
  type RuleRun,
  type SettingsError,
  type XApiError,
  isAutomateError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as Events from "../events/Events.ts";
import * as PeopleStore from "../leads/PeopleStore.ts";
import * as XExtra from "../leads/XExtra.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as RuleStore from "./RuleStore.ts";
import * as Metrics from "../observability/Metrics.ts";

const sameAction = Schema.toEquivalence(Action);

const TICK = "60 seconds";
const OWN_POSTS_LIMIT = 200;
const BEST_WINDOW_DAYS = 7;
const EVERGREEN_POOL = 10;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A threshold rule watches posts this fresh (or newer than the rule), never the whole back catalogue. */
const THRESHOLD_WINDOW_MS = 24 * HOUR_MS;
/** Reposters come from a $0.001 scraper page; likers cost $0.01 a user on X's API, so they are polled less often. */
const POLL_MS = {
  repost: 15 * MINUTE_MS,
  like: 60 * MINUTE_MS,
  followers: 15 * MINUTE_MS,
} as const;
const DRY_RUN_DAYS = 7;

/** auto_delete remembers each post it deleted among the rule's fired subjects. */
const deletedKey = (postId: string) => `deleted:${postId}`;

/** Actions that act on the account, not on the subject: one firing per tick however many subjects matched. */
const perTick = (action: Action) => action.kind === "auto_delete" || action.kind === "auto_retweet";

type EvalError =
  | XApiError
  | ObservationStoreError
  | SettingsError
  | AutomateError
  | LeadsError
  | SqlError;
type Subject = RuleStore.Subject;
type Undo = RuleStore.Undo;

interface OwnPost {
  readonly text: string;
  readonly postId: string;
  readonly createdAt: string;
  readonly views: number;
  readonly likes: number;
  readonly hasLink: boolean;
  readonly isReply: boolean;
}

/** Why a subject fails the rule's conditions, or null when it passes. Data the subject lacks passes. */
const conditionFailure = (
  c: Conditions,
  s: Subject,
  nowMs: number,
  listHandles: ReadonlySet<string>,
): string | null => {
  if (
    c.withinHours !== undefined &&
    s.at !== undefined &&
    nowMs - Date.parse(s.at) > c.withinHours * HOUR_MS
  )
    return `older than ${c.withinHours}h`;
  if (c.link !== undefined && s.post !== undefined && s.post.hasLink !== (c.link === "has"))
    return c.link === "has" ? "no link" : "has a link";
  if (c.notReply === true && s.post?.isReply === true) return "is a reply";
  // The person the rule acts on: a liker, follower or lead has no post, only themselves.
  const followers = s.engager?.followers ?? s.post?.authorFollowers ?? null;
  if (c.minAuthorFollowers !== undefined && followers !== null && followers < c.minAuthorFollowers)
    return `author under ${c.minAuthorFollowers} followers`;
  if (c.notInListId !== undefined && s.engager !== undefined && listHandles.has(s.engager.handle))
    return "already in the list";
  return null;
};

/** Plain words of an X query, for matching observed posts offline in a dry run. */
const queryWords = (query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "" && w !== "or" && !w.startsWith("-") && !w.includes(":"))
    .map((w) => w.replaceAll('"', ""));

interface AuthoredPost {
  readonly postId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly hasLink: boolean;
  readonly isReply: boolean;
  readonly author: {
    readonly userId: string;
    readonly handle: string;
    readonly name: string;
    readonly followers: number | null;
  };
}

/** Someone's post as a subject: the post to act on and its author as the person to act on. */
const authoredSubject = (p: AuthoredPost): Subject => ({
  id: p.postId,
  at: p.createdAt,
  postId: p.postId,
  text: p.text,
  post: { hasLink: p.hasLink, isReply: p.isReply, authorFollowers: p.author.followers },
  engager: {
    userId: p.author.userId,
    handle: p.author.handle,
    name: p.author.name,
    followers: p.author.followers,
  },
  description: `@${p.author.handle}: ${p.text}`,
});

/** Why the rule's own caps refuse spending `costUsd` more, or null when they allow it. */
const overBudget = (rule: Rule, costUsd: number): string | null =>
  rule.spentUsdDay + costUsd > rule.budgetUsdDay
    ? `day budget: $${rule.spentUsdDay.toFixed(3)} spent of $${rule.budgetUsdDay}`
    : rule.spentUsdMonth + costUsd > rule.budgetUsdMonth
      ? `month budget: $${rule.spentUsdMonth.toFixed(3)} spent of $${rule.budgetUsdMonth}`
      : null;

type ActionError = XApiError | LeadsError | AutomateError;

/** The request went out and no answer says how it went (a timeout, an unreadable 200): it may have acted, and costs its quote. */
const mayHaveActed = (e: ActionError) =>
  e._tag === "XApiError" && (e.reason === "http" || e.reason === "decode");

/**
 * Nothing was done, so trying again later is safe: a full budget, no token or X connection, an
 * outage, a rate limit, a local store. A 4xx X answered with is a refusal that would repeat.
 */
const retriable = (e: ActionError) =>
  e._tag !== "XApiError" ||
  e.reason === "budget" ||
  e.reason === "no_token" ||
  (e.reason === "provider" &&
    (e.status === null ||
      e.status >= 500 ||
      e.status === 401 ||
      e.status === 402 ||
      e.status === 429));

const hhmm = (parts: DateTime.DateTime.PartsWithWeekday) =>
  `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;

/** Evaluates rules against X and the session observations, runs the ones that fire, and logs every outcome. */
export class AutomationEngine extends Context.Service<
  AutomationEngine,
  {
    /** What every enabled rule would do right now, with costs. Does not fire anything. */
    readonly preview: Effect.Effect<ReadonlyArray<RulePreview>, AutomateError>;
    /**
     * Evaluates and fires one rule regardless of its enabled flag. Fired subjects stay deduped;
     * evaluations and approvals run one at a time, so the minute tick and Run now never both act.
     */
    readonly runRule: (id: number) => Effect.Effect<ReadonlyArray<RuleRun>, AutomateError>;
    /** Performs a pending request's action now and closes it. */
    readonly approve: (pendingId: number) => Effect.Effect<RuleRun, AutomateError>;
    /** Closes a pending request; its subject never comes back. */
    readonly dismiss: (pendingId: number) => Effect.Effect<void, AutomateError>;
    /** Replays the rule over the last 7 days of observed posts, engagers and followers. No X calls. */
    readonly dryRun7d: (id: number) => Effect.Effect<DryRunReport, AutomateError>;
    /** One scheduler pass: polls, every enabled rule, due undos. The layer calls this every minute. */
    readonly tick: Effect.Effect<void, AutomateError>;
  }
>()("xtend/automate/AutomationEngine") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const x = yield* XClient.XClient;
  const extra = yield* XExtra.XExtra;
  const settings = yield* SettingsStore.SettingsStore;
  const observations = yield* ObservationStore.ObservationStore;
  const rules = yield* RuleStore.RuleStore;
  const people = yield* PeopleStore.PeopleStore;
  const events = yield* Events.Events;
  const fail = (operation: string) => (cause: unknown) =>
    isAutomateError(cause)
      ? cause
      : new AutomateError({ operation, detail: String(cause).slice(0, 200), cause });
  const nowMs = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  // One evaluation or approval at a time: each reads what the last one fired before acting.
  const gate = yield* Semaphore.make(1);
  // Last poll per watched post or follower list; lost on restart, which costs one extra poll.
  const lastPoll = new Map<string, number>();

  const ownHandle = Effect.flatMap(settings.get, ({ handle }) =>
    handle === null
      ? new AutomateError({
          operation: "evaluate",
          detail: "no X handle yet; it comes from your X session, or set it in Settings",
          cause: null,
        })
      : Effect.succeed(handle),
  );

  // Observations carry no parent post id, but a reply's text keeps the @handle of whoever it
  // answers; one that does not name the user is someone else's conversation the session showed.
  const repliesToUser = (
    handle: string,
    p: {
      readonly isReply: boolean;
      readonly text: string;
      readonly author: { readonly handle: string };
    },
  ) =>
    p.isReply &&
    p.author.handle !== handle &&
    new RegExp(`@${handle.replace(/\W/g, "")}\\b`, "i").test(p.text);

  // Session observations first (free, fresh), the scraper timeline (cached 1h) fills what the session never showed.
  // Rules share the read; whichever rule finds it cold pays for it: its caps refuse the read
  // (leaving the session's posts) and it counts against them. A dry run reads it only cached.
  const ownPosts = Effect.fn("AutomationEngine.ownPosts")(function* (rule: Rule) {
    const handle = yield* ownHandle;
    const seen = yield* observations.listRecent({ authorHandle: handle, limit: OWN_POSTS_LIMIT });
    const read =
      (yield* x.cached.userPosts(handle)) ||
      (!rule.dryRun && !(yield* pollRefused(rule, XClient.RATE_CARD.searchPage)));
    const page = read ? yield* x.userPosts(handle, { purpose: "automate.ownPosts" }) : null;
    if (page !== null && !rule.dryRun)
      yield* rules.addSpend(rule.id, page.fromCache ? 0 : XClient.RATE_CARD.searchPage);
    const timeline = page?.items ?? [];
    const byId = new Map<string, OwnPost>();
    // A repost carries someone else's post and reach: plugging, boosting or deleting it is not the user's to do.
    for (const p of [...timeline, ...seen.posts].filter((p) => !p.isRepost))
      byId.set(p.postId, {
        postId: p.postId,
        text: p.text,
        createdAt: p.createdAt,
        views: p.metrics.views ?? 0,
        likes: p.metrics.likes,
        hasLink: p.hasLink,
        isReply: p.isReply,
      });
    return [...byId.values()];
  });

  const postSubject = (p: OwnPost, description: string): Subject => ({
    id: p.postId,
    postId: p.postId,
    text: p.text,
    at: p.createdAt,
    post: { hasLink: p.hasLink, isReply: p.isReply, authorFollowers: null },
    description,
  });

  interface EngagerRow {
    readonly user_id: string;
    readonly handle: string;
    readonly name: string;
    readonly followers: number | null;
    readonly seen_at: string;
  }
  const engagerSubjects = (postId: string, via: "like" | "repost", sinceIso: string) =>
    Effect.map(
      sql<EngagerRow>`
        SELECT user_id, handle, name, followers, seen_at FROM engagers
        WHERE post_id = ${postId} AND via = ${via} AND seen_at >= ${sinceIso} ORDER BY seen_at DESC`,
      (rows) =>
        rows.map((r): Subject => ({
          id: `${via}:${r.user_id}`,
          at: r.seen_at,
          postId,
          engager: { userId: r.user_id, handle: r.handle, name: r.name, followers: r.followers },
          description: `@${r.handle} ${via === "like" ? "liked" : "reposted"} ${postId}`,
        })),
    );

  // The account's first follower check only learns who already followed it; none of them is new.
  const followerSubjects = (sinceIso: string) =>
    Effect.map(
      sql<{ user_id: string; handle: string; first_seen_at: string }>`
        SELECT user_id, handle, first_seen_at FROM followers_seen
        WHERE first_seen_at >= ${sinceIso} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
          AND first_seen_at > (SELECT MIN(first_seen_at) FROM followers_seen WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)})
        ORDER BY first_seen_at DESC`,
      (rows) =>
        rows.map((r): Subject => ({
          id: r.user_id,
          at: r.first_seen_at,
          engager: { userId: r.user_id, handle: r.handle, name: r.handle, followers: null },
          description: `@${r.handle} followed you`,
        })),
    );

  const agentSubjects = (minScore: number, sinceIso: string) =>
    Effect.map(people.agentMatches(minScore, sinceIso), (found) =>
      found.map((p): Subject => ({
        id: `person:${p.id}`,
        at: p.firstSeen,
        engager: { userId: p.userId ?? "", handle: p.handle, name: p.name, followers: p.followers },
        description: `@${p.handle} scored ${p.score} via ${p.source}`,
      })),
    );

  const webhookSubjects = (ruleId: number, sinceIso: string) =>
    Effect.map(rules.webhookEvents(ruleId, sinceIso), (hits) =>
      hits.map((h): Subject => ({
        id: `wh:${h.id}`,
        at: h.at,
        description: `webhook call ${h.id}`,
      })),
    );

  // A poll the rule's caps refuse is logged once (recordRun collapses repeats) and retried next tick.
  const pollRefused = (rule: Rule, quote: number) => {
    const over = overBudget(rule, quote);
    return over === null
      ? Effect.succeed(false)
      : rules
          .recordRun({
            ruleId: rule.id,
            subjectId: "poll",
            status: "skipped",
            detail: `poll costs $${quote}; ${over}`,
            costUsd: 0,
          })
          .pipe(Effect.as(true));
  };

  // A keyword rule's search is its poll, read on each tick and paid each time the 30-minute cache
  // runs out: a live rule's caps refuse it (not a cached one, which is free) and it counts against
  // them. A dry run only gets here with the search cached, and counts nothing.
  const keywordSearch = Effect.fn("AutomationEngine.keywordSearch")(function* (
    rule: Rule,
    query: string,
  ) {
    const refused =
      !rule.dryRun &&
      !(yield* x.cached.search(query, "latest")) &&
      (yield* pollRefused(rule, XClient.RATE_CARD.searchPage));
    if (refused) return [];
    const page = yield* x.searchPosts(query, { mode: "latest", purpose: "automate.keyword" });
    if (!rule.dryRun)
      yield* rules.addSpend(rule.id, page.fromCache ? 0 : XClient.RATE_CARD.searchPage);
    return page.items;
  });

  // Trigger reads that cost money run on their own clock, not on every minute tick, and count
  // against the rule's caps. A dry run charges nothing, so it reads only what earlier polls stored.
  const poll = Effect.fn("AutomationEngine.poll")(function* (rule: Rule) {
    if (rule.dryRun) return;
    const t = rule.trigger;
    const ms = yield* nowMs;
    const at = yield* nowIso;
    if (t.kind === "post_engaged") {
      const key = `${t.via}:${t.postId}`;
      if (ms - (lastPoll.get(key) ?? 0) < POLL_MS[t.via]) return;
      if (yield* pollRefused(rule, XExtra.engagersCostUsd(t.via))) return;
      lastPoll.set(key, ms);
      const { matches, costUsd } = yield* extra.engagers(t.postId, t.via, `automate.${rule.name}`);
      yield* rules.addSpend(rule.id, costUsd);
      for (const m of matches)
        yield* sql`
            INSERT OR IGNORE INTO engagers (post_id, user_id, via, handle, name, followers, seen_at)
            VALUES (${t.postId}, ${m.userId ?? m.handle}, ${t.via}, ${m.handle}, ${m.name}, ${m.followers}, ${at})`;
    } else if (t.kind === "new_follower") {
      const handle = yield* ownHandle;
      const key = `followers:${handle}`;
      if (ms - (lastPoll.get(key) ?? 0) < POLL_MS.followers) return;
      if (yield* pollRefused(rule, XClient.RATE_CARD.followersPage)) return;
      lastPoll.set(key, ms);
      const page = yield* x.followers(handle, { purpose: `automate.${rule.name}`, fresh: true });
      yield* rules.addSpend(rule.id, page.fromCache ? 0 : XClient.RATE_CARD.followersPage);
      yield* people.markFollowersSeen(page.items);
    }
  });

  const subjects = (rule: Rule): Effect.Effect<ReadonlyArray<Subject>, EvalError> => {
    const trigger = rule.trigger;
    switch (trigger.kind) {
      case "post_crosses_threshold":
        return Effect.map(Effect.all([ownPosts(rule), nowMs]), ([posts, ms]) =>
          posts
            .filter((p) => {
              const created = Date.parse(p.createdAt);
              return (
                (created >= Date.parse(rule.createdAt) || created >= ms - THRESHOLD_WINDOW_MS) &&
                p[trigger.metric] >= trigger.threshold &&
                // A plug is an own reply that rides the post's reach; plugging replies would plug the plug.
                !(rule.action.kind === "auto_plug" && p.isReply)
              );
            })
            .map((p) =>
              postSubject(p, `own post ${p.postId} at ${p[trigger.metric]} ${trigger.metric}`),
            ),
        );
      case "schedule":
        return Effect.map(Effect.all([nowMs, settings.get]), ([ms, { timeZone }]) => {
          const local = DateTime.setZone(DateTime.makeUnsafe(ms), SettingsStore.zoneOf(timeZone));
          const parts = DateTime.toParts(local);
          if (!trigger.weekdays.includes(parts.weekDay) || hhmm(parts) < trigger.time) return [];
          const day = DateTime.formatIsoDate(local);
          return [
            { id: `${day} ${trigger.time}`, description: `schedule slot ${day} ${trigger.time}` },
          ];
        });
      // Limitation: engagers the session never scrolled past are invisible.
      case "new_engager":
        return Effect.gen(function* () {
          const handle = yield* ownHandle;
          const { posts } = yield* observations.listRecent({ limit: OWN_POSTS_LIMIT });
          const byUser = new Map<string, Subject>();
          for (const p of posts) {
            if (!repliesToUser(handle, p)) continue;
            byUser.set(p.author.userId, {
              id: p.author.userId,
              at: p.createdAt,
              postId: p.postId,
              post: { hasLink: p.hasLink, isReply: true, authorFollowers: p.author.followers },
              engager: {
                userId: p.author.userId,
                handle: p.author.handle,
                name: p.author.name,
                followers: p.author.followers,
              },
              description: `@${p.author.handle} replied`,
            });
          }
          return [...byUser.values()];
        });
      case "keyword_post":
        return Effect.gen(function* () {
          const { handle } = yield* settings.get;
          // A dry run charges nothing: without a cached search it matches what the session view saw.
          const found =
            rule.dryRun && !(yield* x.cached.search(trigger.query, "latest"))
              ? yield* history(rule, rule.createdAt)
              : (yield* keywordSearch(rule, trigger.query)).map(authoredSubject);
          // Own posts are never keyword subjects: a plug carrying the keyword would answer itself every tick.
          return found.filter((s) => s.engager?.handle !== handle);
        });
      case "post_engaged":
        return engagerSubjects(trigger.postId, trigger.via, rule.createdAt);
      case "new_follower":
        return followerSubjects(rule.createdAt);
      case "agent_match":
        return agentSubjects(trigger.minScore, rule.createdAt);
      case "webhook":
        return webhookSubjects(rule.id, rule.createdAt);
    }
  };

  const bestOwnPost = (rule: Rule, evergreen: boolean) =>
    Effect.flatMap(Effect.all([ownPosts(rule), nowMs]), ([posts, ms]) => {
      const since = ms - BEST_WINDOW_DAYS * DAY_MS;
      const top = posts
        .filter((p) => Date.parse(p.createdAt) >= since)
        .sort((a, b) => b.views - a.views)
        .slice(0, evergreen ? EVERGREEN_POOL : 1);
      return top.length === 0
        ? Effect.succeed(null)
        : Effect.map(Random.nextIntBetween(0, top.length, { halfOpen: true }), (i) => top[i]!);
    });

  const staleOwnPosts = (rule: Rule, olderThanDays: number, maxViews: number) =>
    Effect.map(Effect.all([ownPosts(rule), nowMs]), ([posts, ms]) => {
      const before = ms - olderThanDays * DAY_MS;
      return posts.filter((p) => Date.parse(p.createdAt) < before && p.views < maxViews);
    });

  /** What a failed action already cost: X bills each call that went through before the one that failed. */
  interface PerformFailure {
    readonly error: ActionError;
    readonly costUsd: number;
  }
  interface Performed {
    readonly costUsd: number;
    /** The X id produced or acted on; the runs log shows it and an undo targets it. */
    readonly xId: string | null;
  }

  /** The X call for one subject, or the reason it cannot run. Resolved before the budget check so previews can price it. */
  interface Plan {
    readonly costUsd: number;
    readonly detail: string;
    readonly perform: Effect.Effect<Performed, PerformFailure> | null;
    /** The inverse to schedule when the rule has undoAfterHours. */
    readonly undo?: Undo["kind"];
    /** The own post the plan picked; an ask-first request keeps it, so approval acts on the same one. */
    readonly pin?: string;
    readonly text?: string;
    readonly deletionTargets?: NonNullable<Subject["approval"]>["deletionTargets"];
  }
  const skip = (detail: string): Plan => ({ costUsd: 0, detail, perform: null });
  const single = (
    cost: number,
    xId: string | null,
    call: Effect.Effect<unknown, XApiError | LeadsError>,
  ) =>
    call.pipe(
      Effect.as({ costUsd: cost, xId }),
      Effect.mapError((error): PerformFailure => ({
        error,
        costUsd: mayHaveActed(error) ? cost : 0,
      })),
    );

  const plan = (rule: Rule, s: Subject): Effect.Effect<Plan, EvalError> => {
    const action = rule.action;
    const purpose = `automate.${rule.name}`;
    const cost = actionCostUsd(XClient.RATE_CARD, action);
    const e = s.engager;
    const fill = (text: string) => text.replaceAll("{name}", e?.name ?? "");
    switch (action.kind) {
      case "auto_plug":
        return Effect.succeed(
          s.postId === undefined
            ? skip("auto_plug needs a post to reply to")
            : {
                costUsd: cost,
                detail: `reply to ${s.postId}`,
                undo: "delete_post",
                perform: x.createPost({ text: action.text, replyToPostId: s.postId, purpose }).pipe(
                  Effect.map((r) => ({ costUsd: r.costUsd, xId: r.postId })),
                  Effect.mapError((error): PerformFailure => ({
                    error,
                    costUsd: mayHaveActed(error) ? cost : 0,
                  })),
                ),
              },
        );
      case "auto_like":
        return Effect.succeed(
          s.postId === undefined
            ? skip("auto_like needs a post")
            : {
                costUsd: cost,
                detail: `like ${s.postId}`,
                undo: "unlike",
                perform: single(cost, s.postId, x.like(s.postId, purpose)),
              },
        );
      case "unrepost":
        return Effect.succeed(
          s.postId === undefined
            ? skip("unrepost needs a post")
            : {
                costUsd: cost,
                detail: `unrepost ${s.postId}`,
                perform: single(cost, s.postId, extra.unrepost(s.postId, purpose)),
              },
        );
      case "auto_dm":
        return Effect.succeed(
          e === undefined || e.userId === ""
            ? skip("auto_dm needs an engager with an X user id")
            : {
                costUsd: cost,
                detail: `DM ${e.name}`,
                perform: single(cost, e.userId, x.sendDm(e.userId, fill(action.template), purpose)),
              },
        );
      case "follow":
        return Effect.succeed(
          e === undefined || e.userId === ""
            ? skip("follow needs an engager with an X user id")
            : {
                costUsd: cost,
                detail: `follow @${e.handle}`,
                undo: "unfollow",
                perform: single(cost, e.userId, extra.follow(e.userId, purpose)),
              },
        );
      case "add_to_list":
        return Effect.succeed(
          e === undefined
            ? skip("add_to_list needs an engager")
            : {
                costUsd: 0,
                detail: `add @${e.handle} to list ${action.listId}`,
                perform: single(
                  0,
                  e.userId || null,
                  people.add({
                    handle: e.handle,
                    name: e.name,
                    userId: e.userId === "" ? null : e.userId,
                    followers: e.followers,
                    bio: "",
                    source: `rule:${rule.name}`,
                    listId: action.listId,
                  }),
                ),
              },
        );
      case "notify":
        return Effect.succeed({
          costUsd: 0,
          detail: `notify: ${fill(action.message)}`,
          perform: events
            .publish({
              type: "rule_fired",
              payload: {
                ruleId: rule.id,
                ruleName: rule.name,
                notify: { title: rule.name, body: `${fill(action.message)} (${s.description})` },
              },
            })
            .pipe(Effect.as({ costUsd: 0, xId: s.postId ?? e?.userId ?? null })),
        });
      case "auto_retweet": {
        const repost = (postId: string, detail: string, text?: string): Plan => ({
          costUsd: cost,
          detail,
          undo: "unrepost",
          pin: postId,
          ...(text === undefined ? {} : { text }),
          perform: single(cost, postId, x.repost(postId, purpose)),
        });
        if (s.pinnedPostId !== undefined)
          return Effect.succeed(repost(s.pinnedPostId, `repost ${s.pinnedPostId}`));
        return Effect.map(bestOwnPost(rule, action.evergreen), (best) =>
          best === null
            ? skip("no own post in the last 7 days")
            : repost(best.postId, `repost ${best.postId} (${best.views} views)`, best.text),
        );
      }
      case "clean_profile":
        return Effect.succeed(
          skip("clean_profile is replaced by an unrepost action with undoAfterHours"),
        );
      case "auto_delete":
        return Effect.map(
          s.approval?.deletionTargets !== undefined
            ? Effect.succeed(s.approval.deletionTargets)
            : Effect.map(
                Effect.all([
                  staleOwnPosts(rule, action.olderThanDays, action.maxViews),
                  rules.firedSubjects(rule.id),
                ]),
                // The session view and the cached timeline still list posts after they are deleted.
                ([seen, done]) => seen.filter((p) => !done.has(deletedKey(p.postId))),
              ),
          (stale) => {
            return stale.length === 0
              ? skip("no post matches the age and view limits")
              : {
                  costUsd: cost * stale.length,
                  detail: `delete ${stale.length} posts`,
                  deletionTargets: stale.map(({ postId, text }) => ({ postId, text })),
                  perform: Effect.gen(function* () {
                    let spent = 0;
                    for (const p of stale) {
                      yield* x.deletePost(p.postId, purpose).pipe(
                        // Deleted by hand since it was seen: gone is all this asked for.
                        Effect.catchIf(
                          (e) => e.reason === "provider" && e.status === 404,
                          () => Effect.void,
                        ),
                        Effect.mapError((error): PerformFailure => ({
                          error,
                          costUsd: spent + (mayHaveActed(error) ? cost : 0),
                        })),
                      );
                      spent += cost;
                      yield* rules
                        .markFired(rule.id, [deletedKey(p.postId)])
                        .pipe(
                          Effect.mapError((error): PerformFailure => ({ error, costUsd: spent })),
                        );
                    }
                    return { costUsd: spent, xId: stale.map((p) => p.postId).join(",") };
                  }),
                };
          },
        );
    }
  };

  const pendingPreview = Effect.fn("AutomationEngine.pendingPreview")(function* (
    rule: Rule,
    s: Subject,
    p: Plan,
  ) {
    const action = rule.action;
    if (p.deletionTargets !== undefined)
      return {
        title: p.detail,
        target: null,
        message: null,
        post: null,
        posts: p.deletionTargets.map(({ postId, text }) => ({
          text,
          href: `https://x.com/i/status/${postId}`,
        })),
        because: s.description,
      } satisfies PendingPreview;
    const person = s.engager;
    const personLabel = person === undefined ? "" : `${person.name} · @${person.handle}`;
    const postId = p.pin ?? s.postId;
    const postHref = postId === undefined ? null : `https://x.com/i/status/${postId}`;
    const text = p.text ?? s.text;
    // Only stored observations fill missing context. Opening a request must not buy an X read.
    const observed =
      postId === undefined || text !== undefined
        ? undefined
        : (yield* observations.listRecent({ limit: OWN_POSTS_LIMIT })).posts.find(
            (post) => post.postId === postId,
          );
    const postText = text ?? observed?.text;
    const postLabel =
      p.pin !== undefined || person === undefined ? "Your post" : `@${person.handle}'s post`;
    const recipient =
      action.kind === "auto_dm" || action.kind === "follow" || action.kind === "add_to_list";
    const target =
      recipient && person !== undefined
        ? { label: personLabel, href: `https://x.com/${person.handle}` }
        : postHref === null
          ? null
          : { label: postLabel, href: postHref };
    let title: string;
    switch (action.kind) {
      case "auto_dm":
        title = `DM ${person?.name ?? "engager"}`;
        break;
      case "auto_plug":
        title = `Reply to ${postLabel.toLowerCase()}`;
        break;
      case "auto_like":
        title = `Like ${postLabel.toLowerCase()}`;
        break;
      case "unrepost":
        title = `Unrepost ${postLabel.toLowerCase()}`;
        break;
      case "auto_retweet":
        title = "Repost your post";
        break;
      case "follow":
        title = `Follow ${person?.name ?? "engager"}`;
        break;
      case "add_to_list": {
        const list = (yield* people.lists).find((list) => list.id === action.listId);
        title = `Add ${person?.name ?? "engager"} to ${list?.name ?? "unavailable list"}`;
        break;
      }
      default:
        title = p.detail;
    }
    return {
      title,
      target,
      message:
        action.kind === "auto_plug"
          ? action.text
          : action.kind === "auto_dm"
            ? action.template.replaceAll("{name}", person?.name ?? "")
            : action.kind === "notify"
              ? action.message.replaceAll("{name}", person?.name ?? "")
              : null,
      post: postHref === null || postText === undefined ? null : { text: postText, href: postHref },
      because:
        person !== undefined && s.description.startsWith(`@${person.handle}:`)
          ? `@${person.handle} posted`
          : s.description
              .replace(`own post ${s.postId}`, "your post")
              .replace(` ${s.postId}`, " your post"),
    } satisfies PendingPreview;
  });

  // Subjects the rule has not fired on, that pass its conditions and are past its wait.
  const pending = Effect.fn("AutomationEngine.pending")(function* (rule: Rule) {
    const fired = yield* rules.firedSubjects(rule.id);
    const queued = yield* rules.openPendingSubjects(rule.id);
    // An account-level action already waiting for you is not asked for again.
    if (perTick(rule.action) && queued.size > 0) return [];
    const ms = yield* nowMs;
    const listHandles =
      rule.conditions.notInListId === undefined
        ? new Set<string>()
        : yield* people.listHandles(rule.conditions.notInListId);
    const found = yield* subjects(rule);
    return found.filter(
      (s) =>
        !fired.has(s.id) &&
        !queued.has(s.id) &&
        conditionFailure(rule.conditions, s, ms, listHandles) === null &&
        (s.at === undefined || ms - Date.parse(s.at) >= rule.waitMinutes * MINUTE_MS),
    );
  });

  const preview = Effect.gen(function* () {
    const all = yield* rules.list;
    const out: Array<RulePreview> = [];
    for (const enabled of all.filter((r) => r.enabled)) {
      // Read as a dry run would, from stored and cached data: evaluating must not spend.
      const rule = { ...enabled, dryRun: true };
      const found = yield* pending(rule);
      for (const s of perTick(rule.action) ? found.slice(0, 1) : found) {
        const p = yield* plan(rule, s);
        out.push({
          ruleId: rule.id,
          ruleName: rule.name,
          subjectId: s.id,
          description: `${s.description}; ${p.detail}`,
          costUsd: p.costUsd,
        });
      }
    }
    return out;
  }).pipe(Effect.mapError(fail("preview")));

  /** Runs one subject through budget, dry run and ask-first. `approvedUsd` is what the user approved in Needs you. */
  const fire = Effect.fn("AutomationEngine.fire")(function* (
    rule: Rule,
    s: Subject,
    approvedUsd?: number,
  ) {
    const p = yield* plan(rule, s);
    const base = { ruleId: rule.id, subjectId: s.id, costUsd: p.costUsd };
    if (p.perform === null)
      return yield* rules.recordRun({ ...base, status: "skipped", detail: p.detail, costUsd: 0 });
    // The approval covered the price shown; a plan that grew since (more posts to delete) asks again.
    if (approvedUsd !== undefined && p.costUsd > approvedUsd)
      return yield* rules.recordRun({
        ...base,
        status: "skipped",
        detail: `now costs $${p.costUsd.toFixed(3)}, $${approvedUsd.toFixed(3)} was approved; asking again`,
        costUsd: 0,
      });
    // Re-read: planning auto_retweet or auto_delete may have just paid for the own timeline.
    const over = overBudget(yield* rules.get(rule.id), p.costUsd);
    if (over !== null)
      return yield* rules.recordRun({ ...base, status: "skipped", detail: over, costUsd: 0 });
    if (rule.dryRun)
      return yield* rules.recordRun({ ...base, status: "dry_run", detail: `would ${p.detail}` });
    if (rule.askFirst && approvedUsd === undefined) {
      const preview = yield* pendingPreview(rule, s, p);
      const request = yield* rules.createPending({
        ruleId: rule.id,
        subject: {
          ...s,
          ...(p.pin === undefined ? {} : { pinnedPostId: p.pin }),
          approval: {
            action: rule.action,
            preview,
            ...(p.deletionTargets === undefined ? {} : { deletionTargets: p.deletionTargets }),
          },
        },
        description: `${s.description}; ${p.detail}`,
        costUsd: p.costUsd,
      });
      yield* events.publish({
        type: "rule_fired",
        payload: {
          pending: true,
          pendingId: request.id,
          ruleId: rule.id,
          ruleName: rule.name,
          description: request.description,
          costUsd: p.costUsd,
        },
      });
      return yield* rules.recordRun({
        ...base,
        status: "pending",
        detail: `needs you: ${p.detail}`,
        costUsd: 0,
      });
    }
    // Closed before acting, so a restart mid-call cannot act twice; reopened only when the
    // action surely did nothing. A timeout or a refusal is never retried on its own.
    yield* rules.markFired(rule.id, [s.id]);
    const outcome = yield* Effect.result(p.perform);
    if (outcome._tag === "Failure") {
      const { error, costUsd } = outcome.failure;
      const retry = retriable(error);
      if (retry) yield* rules.unmarkFired(rule.id, s.id);
      const why = retry
        ? ""
        : mayHaveActed(error)
          ? "; it may have gone through, so it is not retried"
          : "; X refused it, so it is not retried";
      // The monthly budget (Budget service, inside XClient) refusing is a skip, not a failure.
      return yield* rules.recordRun({
        ...base,
        status: "reason" in error && error.reason === "budget" ? "skipped" : "failed",
        detail: `${p.detail}: ${error.message}${why}`,
        costUsd,
      });
    }
    const { costUsd, xId } = outcome.success;
    const run = yield* rules.recordRun({ ...base, status: "ok", detail: p.detail, costUsd, xId });
    if (rule.undoAfterHours !== null && p.undo !== undefined && xId !== null && xId !== "")
      yield* rules.scheduleUndo(
        rule.id,
        DateTime.formatIso(DateTime.makeUnsafe((yield* nowMs) + rule.undoAfterHours * HOUR_MS)),
        { kind: p.undo, xId },
      );
    if (rule.action.kind !== "notify")
      yield* events.publish({
        type: "rule_fired",
        payload: { ruleId: rule.id, ruleName: rule.name, detail: p.detail, xId, costUsd },
      });
    return run;
  });

  // `scheduled` is the tick: a rule switched off after the tick listed it is skipped, not run.
  const run = Effect.fn("AutomationEngine.runRule")(
    function* (id: number, scheduled: boolean) {
      const rule = yield* rules.get(id);
      if (scheduled && !rule.enabled) return [];
      const found = yield* poll(rule).pipe(
        Effect.andThen(pending(rule)),
        Effect.catch((cause) =>
          rules
            .recordRun({
              ruleId: rule.id,
              subjectId: "evaluate",
              status: "failed",
              detail: `trigger evaluation: ${String(cause).slice(0, 300)}`,
              costUsd: 0,
            })
            .pipe(Effect.as<ReadonlyArray<Subject>>([])),
        ),
      );
      const due = perTick(rule.action) ? found.slice(0, 1) : found;
      const runs: Array<RuleRun> = [];
      for (const s of due) {
        // Re-read per subject: earlier ones moved its spend, and switching it off is the stop button.
        const current = yield* rules.get(rule.id);
        if (rule.enabled && !current.enabled) break;
        runs.push(
          yield* fire(current, s).pipe(
            Effect.catch((cause) =>
              rules.recordRun({
                ruleId: rule.id,
                subjectId: s.id,
                status: "failed",
                detail: String(cause).slice(0, 300),
                costUsd: 0,
              }),
            ),
          ),
        );
      }
      // One account-level firing (or attempt that closed its subject), or the one request asking
      // for it, covers every subject that matched.
      const first = runs[0];
      if (
        perTick(rule.action) &&
        first !== undefined &&
        (first.status === "pending" || (yield* rules.firedSubjects(rule.id)).has(first.subjectId))
      )
        yield* rules.markFired(
          rule.id,
          found.slice(1).map((s) => s.id),
        );
      return runs;
    },
    Semaphore.withPermits(gate, 1),
    Effect.mapError(fail("runRule")),
  );

  const approve = Effect.fn("AutomationEngine.approve")(
    function* (pendingId: number) {
      const request = yield* rules.pending(pendingId);
      if (request.status !== "pending")
        return yield* new AutomateError({
          operation: "approve",
          detail: `request ${pendingId} is already ${request.status}`,
          cause: null,
        });
      const rule = yield* rules.get(request.ruleId);
      // Approval needs a saved action and message, including for queues from older versions.
      const changed =
        request.subject.approval === undefined ||
        !sameAction(rule.action, request.subject.approval.action);
      const missingTargets =
        rule.action.kind === "auto_delete" &&
        request.subject.approval?.deletionTargets === undefined;
      const run = yield* changed || missingTargets
        ? rules.recordRun({
            ruleId: rule.id,
            subjectId: request.subjectId,
            status: "skipped",
            detail:
              request.subject.approval === undefined
                ? "approval snapshot missing; run the rule again to review it"
                : missingTargets
                  ? "deletion targets were not saved; run the rule again to review them"
                  : "rule action changed; run the rule again to review it",
            costUsd: 0,
          })
        : fire(rule, request.subject, request.costUsd);
      yield* rules.settlePending(pendingId, "approved", run.id);
      return run;
    },
    Semaphore.withPermits(gate, 1),
    Effect.mapError(fail("approve")),
  );

  const dismiss = Effect.fn("AutomationEngine.dismiss")(
    function* (pendingId: number) {
      const request = yield* rules.pending(pendingId);
      if (request.status !== "pending")
        return yield* new AutomateError({
          operation: "dismiss",
          detail: `request ${pendingId} is already ${request.status}`,
          cause: null,
        });
      yield* rules.settlePending(pendingId, "dismissed", null);
      yield* rules.markFired(request.ruleId, [request.subjectId]);
    },
    Semaphore.withPermits(gate, 1),
    Effect.mapError(fail("dismiss")),
  );

  const performUndo = (u: Undo, purpose: string) => {
    switch (u.kind) {
      case "unlike":
        return extra.unlike(u.xId, purpose);
      case "unrepost":
        return extra.unrepost(u.xId, purpose);
      case "unfollow":
        return extra.unfollow(u.xId, purpose);
      case "delete_post":
        return x.deletePost(u.xId, purpose);
    }
  };

  const runUndos = Effect.gen(function* () {
    const due = yield* rules.dueUndos(yield* nowIso);
    for (const d of due) {
      const rule = yield* rules.get(d.ruleId);
      const outcome = yield* Effect.result(performUndo(d.undo, `automate.${rule.name}.undo`));
      // An outage, rate limit or full budget did nothing: the undo stays due for the next tick.
      if (outcome._tag === "Success" || !retriable(outcome.failure))
        yield* rules.settleUndo(d.id, outcome._tag === "Success" ? "done" : "failed");
      yield* rules.recordRun({
        ruleId: rule.id,
        subjectId: `undo:${d.id}`,
        status: outcome._tag === "Success" ? "ok" : "failed",
        detail:
          outcome._tag === "Success"
            ? `${d.undo.kind} ${d.undo.xId}`
            : `${d.undo.kind} ${d.undo.xId}: ${outcome.failure.message}`,
        costUsd:
          outcome._tag === "Success" || mayHaveActed(outcome.failure)
            ? XClient.RATE_CARD.delete
            : 0,
        xId: d.undo.xId,
      });
    }
  });

  // What the trigger would have matched over the window, from stored data only.
  const history = (
    rule: Rule,
    sinceIso: string,
  ): Effect.Effect<ReadonlyArray<Subject>, EvalError> => {
    const t = rule.trigger;
    const sinceMs = Date.parse(sinceIso);
    switch (t.kind) {
      case "post_crosses_threshold":
        return Effect.gen(function* () {
          const handle = yield* ownHandle;
          const { posts } = yield* observations.listRecent({
            authorHandle: handle,
            limit: OWN_POSTS_LIMIT,
          });
          return posts
            .filter(
              (p) =>
                !p.isRepost &&
                Date.parse(p.createdAt) >= sinceMs &&
                (p.metrics[t.metric] ?? 0) >= t.threshold &&
                !(rule.action.kind === "auto_plug" && p.isReply),
            )
            .map((p) =>
              postSubject(
                { ...p, views: p.metrics.views ?? 0, likes: p.metrics.likes },
                `own post ${p.postId} at ${p.metrics[t.metric] ?? 0} ${t.metric}`,
              ),
            );
        });
      // Live, own posts are never keyword subjects either.
      case "keyword_post":
        return Effect.map(
          Effect.all([observations.listRecent({ limit: OWN_POSTS_LIMIT }), settings.get]),
          ([{ posts }, { handle }]) => {
            const words = queryWords(t.query);
            return posts
              .filter(
                (p) =>
                  Date.parse(p.createdAt) >= sinceMs &&
                  p.author.handle !== handle &&
                  words.some((w) => p.text.toLowerCase().includes(w)),
              )
              .map(authoredSubject);
          },
        );
      case "new_engager":
        return Effect.gen(function* () {
          const handle = yield* ownHandle;
          const { posts } = yield* observations.listRecent({ limit: OWN_POSTS_LIMIT });
          return posts
            .filter((p) => repliesToUser(handle, p) && Date.parse(p.createdAt) >= sinceMs)
            .map((p): Subject => ({
              id: p.author.userId,
              at: p.createdAt,
              postId: p.postId,
              post: { hasLink: p.hasLink, isReply: true, authorFollowers: p.author.followers },
              engager: {
                userId: p.author.userId,
                handle: p.author.handle,
                name: p.author.name,
                followers: p.author.followers,
              },
              description: `@${p.author.handle} replied`,
            }));
        });
      // Slots in the user's zone, as the live trigger fires them, that fell inside the window.
      case "schedule":
        return Effect.map(Effect.all([nowMs, settings.get]), ([ms, { timeZone }]) => {
          const zone = SettingsStore.zoneOf(timeZone);
          const out: Array<Subject> = [];
          for (let d = 0; d <= DRY_RUN_DAYS; d++) {
            const day = DateTime.toParts(
              DateTime.setZone(DateTime.makeUnsafe(ms - d * DAY_MS), zone),
            );
            if (!t.weekdays.includes(day.weekDay)) continue;
            const slot = DateTime.makeZonedUnsafe(
              {
                year: day.year,
                month: day.month,
                day: day.day,
                hour: Number(t.time.slice(0, 2)),
                minute: Number(t.time.slice(3, 5)),
              },
              { timeZone: zone, adjustForTimeZone: true },
            );
            const slotMs = DateTime.toEpochMillis(slot);
            if (slotMs > ms || slotMs < sinceMs) continue;
            const iso = DateTime.formatIsoDate(slot);
            out.push({
              id: `${iso} ${t.time}`,
              at: DateTime.formatIso(slot),
              description: `schedule slot ${iso} ${t.time}`,
            });
          }
          return out;
        });
      case "post_engaged":
        return engagerSubjects(t.postId, t.via, sinceIso);
      case "new_follower":
        return followerSubjects(sinceIso);
      case "agent_match":
        return agentSubjects(t.minScore, sinceIso);
      case "webhook":
        return webhookSubjects(rule.id, sinceIso);
    }
  };

  const dryRun7d = Effect.fn("AutomationEngine.dryRun7d")(
    function* (id: number) {
      const rule = yield* rules.get(id);
      const ms = yield* nowMs;
      const since = DateTime.formatIso(DateTime.makeUnsafe(ms - DRY_RUN_DAYS * DAY_MS));
      const listHandles =
        rule.conditions.notInListId === undefined
          ? new Set<string>()
          : yield* people.listHandles(rule.conditions.notInListId);
      const unit = actionCostUsd(XClient.RATE_CARD, rule.action);
      const fired = (yield* history(rule, since))
        // Conditions are judged as of the subject's own moment, so "within N hours" reads as it would have then.
        .filter(
          (s) =>
            conditionFailure(
              rule.conditions,
              s,
              s.at === undefined ? ms : Date.parse(s.at),
              listHandles,
            ) === null,
        )
        .map((s) => ({ at: s.at ?? since, description: s.description, costUsd: unit }))
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      return { fired, totalUsd: fired.reduce((sum, f) => sum + f.costUsd, 0) };
    },
    Effect.mapError(fail("dryRun7d")),
  );

  const tick = Effect.gen(function* () {
    const all = yield* rules.list;
    // One rule failing (deleted mid-tick, its store down) must not starve the rules after it or the undos.
    yield* Effect.forEach(
      all.filter((r) => r.enabled),
      (r) =>
        run(r.id, true).pipe(
          Effect.catch((error) => Effect.logWarning(`automation rule ${r.id} failed`, error)),
        ),
      { discard: true },
    );
    yield* runUndos;
  }).pipe(Effect.mapError(fail("tick")));

  return AutomationEngine.of({
    preview,
    // `run` already traces as AutomationEngine.runRule.
    runRule: Effect.fnUntraced(function* (id: number) {
      return yield* run(id, false);
    }),
    approve,
    dismiss,
    dryRun7d,
    tick,
  });
});

export const layer = Layer.effect(AutomationEngine, make);

/** The minute scheduler. Failures are logged and the loop continues. */
export const layerScheduler = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* AutomationEngine;
    yield* engine.tick.pipe(
      Metrics.withJobMetrics("automate.rules"),
      Effect.catchCause((cause) => Effect.logWarning("automation tick failed", cause)),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
).pipe(Layer.provide(layer));

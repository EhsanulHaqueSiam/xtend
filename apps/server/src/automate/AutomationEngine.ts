import {
  type Action,
  actionCostUsd,
  AutomateError,
  type Conditions,
  type DryRunReport,
  type LeadsError,
  type ObservationStoreError,
  type Rule,
  type RulePreview,
  type RuleRun,
  type SettingsError,
  type XApiError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import * as Events from "../events/Events.ts";
import * as PeopleStore from "../leads/PeopleStore.ts";
import * as XExtra from "../leads/XExtra.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as RuleStore from "./RuleStore.ts";

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
  if (
    c.minAuthorFollowers !== undefined &&
    s.post?.authorFollowers !== undefined &&
    s.post.authorFollowers !== null &&
    s.post.authorFollowers < c.minAuthorFollowers
  )
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

/** Evaluates rules against X and the session observations, runs the ones that fire, and logs every outcome. */
export class AutomationEngine extends Context.Service<
  AutomationEngine,
  {
    /** What every enabled rule would do right now, with costs. Does not fire anything. */
    readonly preview: Effect.Effect<ReadonlyArray<RulePreview>, AutomateError>;
    /** Evaluates and fires one rule regardless of its enabled flag. Fired subjects stay deduped. */
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
    cause instanceof AutomateError
      ? cause
      : new AutomateError({ operation, detail: String(cause).slice(0, 200), cause });
  const nowMs = Effect.map(DateTime.now, DateTime.toEpochMillis);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  // Subjects being fired right now, so the minute tick and Run now cannot both act on one.
  const inFlight = new Set<string>();
  // Last poll per watched post or follower list; lost on restart, which costs one extra poll.
  const lastPoll = new Map<string, number>();

  const ownHandle = Effect.flatMap(settings.get, ({ handle }) =>
    handle === null
      ? new AutomateError({
          operation: "evaluate",
          detail: "set your X handle in Settings first",
          cause: null,
        })
      : Effect.succeed(handle),
  );

  // Session observations first (free, fresh), the scraper timeline (cached 1h) fills what the session never showed.
  const ownPosts = Effect.gen(function* () {
    const handle = yield* ownHandle;
    const seen = yield* observations.listRecent({ authorHandle: handle, limit: OWN_POSTS_LIMIT });
    const timeline = yield* x.userPosts(handle, { purpose: "automate.ownPosts" });
    const byId = new Map<string, OwnPost>();
    for (const p of [...timeline.items, ...seen.posts])
      byId.set(p.postId, {
        postId: p.postId,
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

  const followerSubjects = (sinceIso: string) =>
    Effect.map(
      sql<{ user_id: string; handle: string; first_seen_at: string }>`
        SELECT user_id, handle, first_seen_at FROM followers_seen WHERE first_seen_at >= ${sinceIso} ORDER BY first_seen_at DESC`,
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

  // Trigger reads that cost money run on their own clock, not on every minute tick.
  const poll = (rule: Rule) =>
    Effect.gen(function* () {
      const t = rule.trigger;
      const ms = yield* nowMs;
      const at = yield* nowIso;
      if (t.kind === "post_engaged") {
        const key = `${t.via}:${t.postId}`;
        if (ms - (lastPoll.get(key) ?? 0) < POLL_MS[t.via]) return;
        lastPoll.set(key, ms);
        const { matches } = yield* extra.engagers(t.postId, t.via, `automate.${rule.name}`);
        for (const m of matches)
          yield* sql`
            INSERT OR IGNORE INTO engagers (post_id, user_id, via, handle, name, followers, seen_at)
            VALUES (${t.postId}, ${m.userId ?? m.handle}, ${t.via}, ${m.handle}, ${m.name}, ${m.followers}, ${at})`;
      } else if (t.kind === "new_follower") {
        if (ms - (lastPoll.get("followers") ?? 0) < POLL_MS.followers) return;
        lastPoll.set("followers", ms);
        const handle = yield* ownHandle;
        const page = yield* x.followers(handle, { purpose: `automate.${rule.name}` });
        yield* people.markFollowersSeen(page.items);
      }
    });

  const subjects = (rule: Rule): Effect.Effect<ReadonlyArray<Subject>, EvalError> => {
    const trigger = rule.trigger;
    switch (trigger.kind) {
      case "post_crosses_threshold":
        return Effect.map(Effect.all([ownPosts, nowMs]), ([posts, ms]) =>
          posts
            .filter((p) => {
              const created = Date.parse(p.createdAt);
              return (
                (created >= Date.parse(rule.createdAt) || created >= ms - THRESHOLD_WINDOW_MS) &&
                p[trigger.metric] >= trigger.threshold
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
          const hhmm = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
          if (!trigger.weekdays.includes(parts.weekDay) || hhmm < trigger.time) return [];
          const day = DateTime.formatIsoDate(local);
          return [
            { id: `${day} ${trigger.time}`, description: `schedule slot ${day} ${trigger.time}` },
          ];
        });
      // Limitation: observations carry no parent post id, so every reply the session view showed
      // from someone else counts as an engager, and engagers the session never scrolled past are invisible.
      case "new_engager":
        return Effect.gen(function* () {
          const handle = yield* ownHandle;
          const { posts } = yield* observations.listRecent({ limit: OWN_POSTS_LIMIT });
          const byUser = new Map<string, Subject>();
          for (const p of posts) {
            if (!p.isReply || p.author.handle === handle) continue;
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
        return Effect.map(
          x.searchPosts(trigger.query, { mode: "latest", purpose: "automate.keyword" }),
          (page) =>
            page.items.map((p): Subject => ({
              id: p.postId,
              at: p.createdAt,
              postId: p.postId,
              post: { hasLink: p.hasLink, isReply: p.isReply, authorFollowers: p.author.followers },
              engager: {
                userId: p.author.userId,
                handle: p.author.handle,
                name: p.author.name,
                followers: p.author.followers,
              },
              description: `@${p.author.handle}: ${p.text.slice(0, 60)}`,
            })),
        );
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

  const bestOwnPost = (evergreen: boolean) =>
    Effect.map(Effect.all([ownPosts, nowMs]), ([posts, ms]) => {
      const since = ms - BEST_WINDOW_DAYS * DAY_MS;
      const top = posts
        .filter((p) => Date.parse(p.createdAt) >= since)
        .sort((a, b) => b.views - a.views)
        .slice(0, evergreen ? EVERGREEN_POOL : 1);
      return top.length === 0 ? null : top[Math.floor(Math.random() * top.length)]!;
    });

  const staleOwnPosts = (olderThanDays: number, maxViews: number) =>
    Effect.map(Effect.all([ownPosts, nowMs]), ([posts, ms]) => {
      const before = ms - olderThanDays * DAY_MS;
      return posts.filter((p) => Date.parse(p.createdAt) < before && p.views < maxViews);
    });

  /** What a failed action already cost: X bills each call that went through before the one that failed. */
  interface PerformFailure {
    readonly error: XApiError | LeadsError;
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
  }
  const skip = (detail: string): Plan => ({ costUsd: 0, detail, perform: null });
  const single = (
    cost: number,
    xId: string | null,
    call: Effect.Effect<unknown, XApiError | LeadsError>,
  ) =>
    call.pipe(
      Effect.as({ costUsd: cost, xId }),
      Effect.mapError((error): PerformFailure => ({ error, costUsd: 0 })),
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
                  Effect.mapError((error): PerformFailure => ({ error, costUsd: 0 })),
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
      case "auto_retweet":
        return Effect.map(bestOwnPost(action.evergreen), (best) =>
          best === null
            ? skip("no own post in the last 7 days")
            : {
                costUsd: cost,
                detail: `repost ${best.postId} (${best.views} views)`,
                undo: "unrepost",
                perform: single(cost, best.postId, x.repost(best.postId, purpose)),
              },
        );
      case "clean_profile":
        return Effect.succeed(
          skip("clean_profile is replaced by an unrepost action with undoAfterHours"),
        );
      case "auto_delete":
        return Effect.map(staleOwnPosts(action.olderThanDays, action.maxViews), (stale) =>
          stale.length === 0
            ? skip("no post matches the age and view limits")
            : {
                costUsd: cost * stale.length,
                detail: `delete ${stale.length} posts`,
                perform: Effect.gen(function* () {
                  let spent = 0;
                  for (const p of stale) {
                    yield* x
                      .deletePost(p.postId, purpose)
                      .pipe(
                        Effect.mapError((error): PerformFailure => ({ error, costUsd: spent })),
                      );
                    spent += cost;
                  }
                  return { costUsd: spent, xId: stale.map((p) => p.postId).join(",") };
                }),
              },
        );
    }
  };

  // Subjects the rule has not fired on, that pass its conditions and are past its wait.
  const pending = (rule: Rule) =>
    Effect.gen(function* () {
      const fired = yield* rules.firedSubjects(rule.id);
      const queued = yield* rules.openPendingSubjects(rule.id);
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
    for (const rule of all.filter((r) => r.enabled)) {
      for (const s of yield* pending(rule)) {
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

  const fire = (stale: Rule, s: Subject, approved = false) =>
    Effect.gen(function* () {
      // Re-read the rule: earlier subjects in this batch already moved its spend.
      const rule = yield* rules.get(stale.id);
      const p = yield* plan(rule, s);
      const base = { ruleId: rule.id, subjectId: s.id, costUsd: p.costUsd };
      if (p.perform === null)
        return yield* rules.recordRun({ ...base, status: "skipped", detail: p.detail, costUsd: 0 });
      if (rule.spentUsdDay + p.costUsd > rule.budgetUsdDay)
        return yield* rules.recordRun({
          ...base,
          status: "skipped",
          detail: `day budget: $${rule.spentUsdDay.toFixed(3)} spent of $${rule.budgetUsdDay}`,
          costUsd: 0,
        });
      if (rule.spentUsdMonth + p.costUsd > rule.budgetUsdMonth)
        return yield* rules.recordRun({
          ...base,
          status: "skipped",
          detail: `month budget: $${rule.spentUsdMonth.toFixed(3)} spent of $${rule.budgetUsdMonth}`,
          costUsd: 0,
        });
      if (rule.dryRun)
        return yield* rules.recordRun({ ...base, status: "dry_run", detail: `would ${p.detail}` });
      if (rule.askFirst && !approved) {
        const request = yield* rules.createPending({
          ruleId: rule.id,
          subject: s,
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
      const outcome = yield* Effect.result(p.perform);
      if (outcome._tag === "Failure") {
        // The monthly budget (Budget service, inside XClient) refusing is a skip, not a failure.
        const { error, costUsd } = outcome.failure;
        return yield* rules.recordRun({
          ...base,
          status: "reason" in error && error.reason === "budget" ? "skipped" : "failed",
          detail: `${p.detail}: ${error.message}`,
          costUsd,
        });
      }
      const { costUsd, xId } = outcome.success;
      const run = yield* rules.recordRun({ ...base, status: "ok", detail: p.detail, costUsd, xId });
      if (rule.undoAfterHours !== null && p.undo !== undefined && xId !== null)
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

  const runRule = Effect.fn("AutomationEngine.runRule")(
    function* (id: number) {
      const rule = yield* rules.get(id);
      const found = yield* poll(rule).pipe(
        Effect.andThen(pending(rule)),
        Effect.catch((cause) =>
          Effect.flatMap(nowIso, (at) =>
            rules
              .recordRun({
                ruleId: rule.id,
                subjectId: `evaluate ${at}`,
                status: "failed",
                detail: `trigger evaluation: ${String(cause).slice(0, 300)}`,
                costUsd: 0,
              })
              .pipe(Effect.as<ReadonlyArray<Subject>>([])),
          ),
        ),
      );
      const free = found.filter((s) => !inFlight.has(`${rule.id}:${s.id}`));
      const due = perTick(rule.action) ? free.slice(0, 1) : free;
      for (const s of due) inFlight.add(`${rule.id}:${s.id}`);
      const runs = yield* Effect.forEach(due, (s) => fire(rule, s)).pipe(
        Effect.ensuring(
          Effect.sync(() => due.forEach((s) => inFlight.delete(`${rule.id}:${s.id}`))),
        ),
      );
      // One account-level firing covered every subject that matched this tick.
      if (perTick(rule.action) && runs[0]?.status === "ok")
        yield* rules.markFired(
          rule.id,
          free.map((s) => s.id),
        );
      return runs;
    },
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
      const run = yield* fire(rule, request.subject, true);
      yield* rules.settlePending(pendingId, "approved", run.id);
      return run;
    },
    Effect.mapError(fail("approve")),
  );

  const dismiss = Effect.fn("AutomationEngine.dismiss")(
    function* (pendingId: number) {
      const request = yield* rules.pending(pendingId);
      yield* rules.settlePending(pendingId, "dismissed", null);
      yield* rules.markFired(request.ruleId, [request.subjectId]);
    },
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
      yield* rules.settleUndo(d.id, outcome._tag === "Success" ? "done" : "failed");
      yield* rules.recordRun({
        ruleId: rule.id,
        subjectId: `undo:${d.id}`,
        status: outcome._tag === "Success" ? "ok" : "failed",
        detail:
          outcome._tag === "Success"
            ? `${d.undo.kind} ${d.undo.xId}`
            : `${d.undo.kind} ${d.undo.xId}: ${outcome.failure.message}`,
        costUsd: outcome._tag === "Success" ? XClient.RATE_CARD.delete : 0,
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
                Date.parse(p.createdAt) >= sinceMs && (p.metrics[t.metric] ?? 0) >= t.threshold,
            )
            .map((p) =>
              postSubject(
                { ...p, views: p.metrics.views ?? 0, likes: p.metrics.likes },
                `own post ${p.postId} at ${p.metrics[t.metric] ?? 0} ${t.metric}`,
              ),
            );
        });
      case "keyword_post":
        return Effect.map(observations.listRecent({ limit: OWN_POSTS_LIMIT }), ({ posts }) => {
          const words = queryWords(t.query);
          return posts
            .filter(
              (p) =>
                Date.parse(p.createdAt) >= sinceMs &&
                words.some((w) => p.text.toLowerCase().includes(w)),
            )
            .map((p): Subject => ({
              id: p.postId,
              at: p.createdAt,
              postId: p.postId,
              post: { hasLink: p.hasLink, isReply: p.isReply, authorFollowers: p.author.followers },
              engager: {
                userId: p.author.userId,
                handle: p.author.handle,
                name: p.author.name,
                followers: p.author.followers,
              },
              description: `@${p.author.handle}: ${p.text.slice(0, 60)}`,
            }));
        });
      case "new_engager":
        return Effect.gen(function* () {
          const handle = yield* ownHandle;
          const { posts } = yield* observations.listRecent({ limit: OWN_POSTS_LIMIT });
          return posts
            .filter(
              (p) => p.isReply && p.author.handle !== handle && Date.parse(p.createdAt) >= sinceMs,
            )
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
      case "schedule":
        return Effect.map(nowMs, (ms) => {
          const out: Array<Subject> = [];
          for (let d = 0; d < DRY_RUN_DAYS; d++) {
            const day = DateTime.makeUnsafe(ms - d * DAY_MS);
            if (t.weekdays.includes(DateTime.toParts(day).weekDay)) {
              const iso = DateTime.formatIsoDate(day);
              out.push({
                id: `${iso} ${t.time}`,
                at: DateTime.formatIso(day),
                description: `schedule slot ${iso} ${t.time}`,
              });
            }
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
    yield* Effect.forEach(
      all.filter((r) => r.enabled),
      (r) => runRule(r.id),
      { discard: true },
    );
    yield* runUndos;
  }).pipe(Effect.mapError(fail("tick")));

  return AutomationEngine.of({ preview, runRule, approve, dismiss, dryRun7d, tick });
});

export const layer = Layer.effect(AutomationEngine, make);

/** The minute scheduler. Failures are logged and the loop continues. */
export const layerScheduler = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* AutomationEngine;
    yield* engine.tick.pipe(
      Effect.catchCause((cause) => Effect.logWarning("automation tick failed", cause)),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
).pipe(Layer.provide(layer));

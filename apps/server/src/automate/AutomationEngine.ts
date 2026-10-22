import {
  type Action,
  actionCostUsd,
  AutomateError,
  type ObservationStoreError,
  type Rule,
  type RulePreview,
  type RuleRun,
  type SettingsError,
  type Trigger,
  type XApiError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as RuleStore from "./RuleStore.ts";

const TICK = "60 seconds";
const OWN_POSTS_LIMIT = 200;
const BEST_WINDOW_DAYS = 7;
const EVERGREEN_POOL = 10;
const DAY_MS = 86_400_000;

type EvalError = XApiError | ObservationStoreError | SettingsError | AutomateError;

interface OwnPost {
  readonly postId: string;
  readonly createdAt: string;
  readonly views: number;
  readonly likes: number;
}

/** What a trigger matched: a post to act on, an engager to message, or just a slot to dedupe on. */
interface Subject {
  readonly id: string;
  readonly description: string;
  readonly postId?: string;
  readonly engager?: { readonly userId: string; readonly name: string };
}

/** Evaluates rules against X and the session observations, runs the ones that fire, and logs every outcome. */
export class AutomationEngine extends Context.Service<
  AutomationEngine,
  {
    /** What every enabled rule would do right now, with costs. Does not fire anything. */
    readonly preview: Effect.Effect<ReadonlyArray<RulePreview>, AutomateError>;
    /** Evaluates and fires one rule regardless of its enabled flag. Fired subjects stay deduped. */
    readonly runRule: (id: number) => Effect.Effect<ReadonlyArray<RuleRun>, AutomateError>;
    /** One scheduler pass over every enabled rule. The layer calls this every minute. */
    readonly tick: Effect.Effect<void, AutomateError>;
  }
>()("xtend/automate/AutomationEngine") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const settings = yield* SettingsStore.SettingsStore;
  const observations = yield* ObservationStore.ObservationStore;
  const rules = yield* RuleStore.RuleStore;
  const fail = (operation: string) => (cause: unknown) =>
    cause instanceof AutomateError
      ? cause
      : new AutomateError({ operation, detail: String(cause).slice(0, 200), cause });
  const nowMs = Effect.map(DateTime.now, DateTime.toEpochMillis);

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
    for (const p of timeline.items)
      byId.set(p.postId, {
        postId: p.postId,
        createdAt: p.createdAt,
        views: p.metrics.views ?? 0,
        likes: p.metrics.likes,
      });
    for (const p of seen.posts)
      byId.set(p.postId, {
        postId: p.postId,
        createdAt: p.createdAt,
        views: p.metrics.views ?? 0,
        likes: p.metrics.likes,
      });
    return [...byId.values()];
  });

  const subjects = (trigger: Trigger): Effect.Effect<ReadonlyArray<Subject>, EvalError> => {
    switch (trigger.kind) {
      case "post_crosses_threshold":
        return Effect.map(ownPosts, (posts) =>
          posts
            .filter((p) => p[trigger.metric] >= trigger.threshold)
            .map((p) => ({
              id: p.postId,
              postId: p.postId,
              description: `own post ${p.postId} at ${p[trigger.metric]} ${trigger.metric}`,
            })),
        );
      case "schedule":
        return Effect.map(nowMs, (ms) => {
          // Slots are wall-clock on the machine running the service.
          const local = DateTime.setZone(DateTime.makeUnsafe(ms), DateTime.zoneMakeLocal());
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
            if (!p.isReply || p.author.handle.toLowerCase() === handle.toLowerCase()) continue;
            byUser.set(p.author.userId, {
              id: p.author.userId,
              postId: p.postId,
              engager: { userId: p.author.userId, name: p.author.name },
              description: `@${p.author.handle} replied`,
            });
          }
          return [...byUser.values()];
        });
      case "keyword_post":
        return Effect.map(
          x.searchPosts(trigger.query, { mode: "latest", purpose: "automate.keyword" }),
          (page) =>
            page.items.map((p) => ({
              id: p.postId,
              postId: p.postId,
              engager: { userId: p.author.userId, name: p.author.name },
              description: `@${p.author.handle}: ${p.text.slice(0, 60)}`,
            })),
        );
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

  /** The X call for one subject, or the reason it cannot run. Resolved before the budget check so previews can price it. */
  interface Plan {
    readonly costUsd: number;
    readonly detail: string;
    readonly perform: Effect.Effect<void, XApiError> | null;
  }
  const skip = (detail: string): Plan => ({ costUsd: 0, detail, perform: null });

  const plan = (action: Action, s: Subject, purpose: string): Effect.Effect<Plan, EvalError> => {
    const cost = actionCostUsd(action);
    switch (action.kind) {
      case "auto_plug":
        return Effect.succeed(
          s.postId === undefined
            ? skip("auto_plug needs a post to reply to")
            : {
                costUsd: cost,
                detail: `reply to ${s.postId}`,
                perform: Effect.asVoid(
                  x.createPost({ text: action.text, replyToPostId: s.postId, purpose }),
                ),
              },
        );
      case "auto_like":
        return Effect.succeed(
          s.postId === undefined
            ? skip("auto_like needs a post")
            : { costUsd: cost, detail: `like ${s.postId}`, perform: x.like(s.postId, purpose) },
        );
      case "auto_dm": {
        const e = s.engager;
        return Effect.succeed(
          e === undefined
            ? skip("auto_dm needs an engager")
            : {
                costUsd: cost,
                detail: `DM ${e.name}`,
                perform: x.sendDm(e.userId, action.template.replaceAll("{name}", e.name), purpose),
              },
        );
      }
      case "auto_retweet":
        return Effect.map(bestOwnPost(action.evergreen), (best) =>
          best === null
            ? skip("no own post in the last 7 days")
            : {
                costUsd: cost,
                detail: `repost ${best.postId} (${best.views} views)`,
                perform: x.repost(best.postId, purpose),
              },
        );
      case "clean_profile":
        return Effect.succeed(skip("XClient has no unrepost method yet"));
      case "auto_delete":
        return Effect.map(staleOwnPosts(action.olderThanDays, action.maxViews), (stale) =>
          stale.length === 0
            ? skip("no post matches the age and view limits")
            : {
                costUsd: cost * stale.length,
                detail: `delete ${stale.length} posts`,
                perform: Effect.forEach(stale, (p) => x.deletePost(p.postId, purpose), {
                  discard: true,
                }),
              },
        );
    }
  };

  const pending = (rule: Rule) =>
    Effect.gen(function* () {
      const fired = yield* rules.firedSubjects(rule.id);
      const found = yield* subjects(rule.trigger);
      return found.filter((s) => !fired.has(s.id));
    });

  const preview = Effect.gen(function* () {
    const all = yield* rules.list;
    const out: Array<RulePreview> = [];
    for (const rule of all.filter((r) => r.enabled)) {
      for (const s of yield* pending(rule)) {
        const p = yield* plan(rule.action, s, `automate.${rule.name}`);
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

  const fire = (rule: Rule, s: Subject) =>
    Effect.gen(function* () {
      const p = yield* plan(rule.action, s, `automate.${rule.name}`);
      const base = { ruleId: rule.id, subjectId: s.id, costUsd: p.costUsd };
      if (p.perform === null)
        return yield* rules.recordRun({ ...base, status: "skipped", detail: p.detail, costUsd: 0 });
      if (rule.spentUsdMonth + p.costUsd > rule.budgetUsdMonth)
        return yield* rules.recordRun({
          ...base,
          status: "skipped",
          detail: `rule budget: $${rule.spentUsdMonth.toFixed(3)} spent of $${rule.budgetUsdMonth}`,
          costUsd: 0,
        });
      if (yield* settings.wouldExceedBudget(p.costUsd))
        return yield* rules.recordRun({
          ...base,
          status: "skipped",
          detail: "monthly budget reached; raise it in Settings",
          costUsd: 0,
        });
      if (rule.dryRun)
        return yield* rules.recordRun({ ...base, status: "dry_run", detail: `would ${p.detail}` });
      const outcome = yield* Effect.result(p.perform);
      return outcome._tag === "Success"
        ? yield* rules.recordRun({ ...base, status: "ok", detail: p.detail })
        : yield* rules.recordRun({
            ...base,
            status: "failed",
            detail: `${p.detail}: ${outcome.failure.message}`,
            costUsd: 0,
          });
    });

  const runRule = Effect.fn("AutomationEngine.runRule")(
    function* (id: number) {
      const rule = yield* rules.get(id);
      const due = yield* pending(rule).pipe(
        Effect.catch((cause) =>
          Effect.flatMap(nowMs, (ms) =>
            rules
              .recordRun({
                ruleId: rule.id,
                subjectId: `evaluate ${DateTime.formatIso(DateTime.makeUnsafe(ms))}`,
                status: "failed",
                detail: `trigger evaluation: ${String(cause).slice(0, 300)}`,
                costUsd: 0,
              })
              .pipe(Effect.as<ReadonlyArray<Subject>>([])),
          ),
        ),
      );
      return yield* Effect.forEach(due, (s) => fire(rule, s));
    },
    Effect.mapError(fail("runRule")),
  );

  const tick = Effect.gen(function* () {
    const all = yield* rules.list;
    yield* Effect.forEach(
      all.filter((r) => r.enabled),
      (r) => runRule(r.id),
      { discard: true },
    );
  }).pipe(Effect.mapError(fail("tick")));

  return AutomationEngine.of({ preview, runRule, tick });
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

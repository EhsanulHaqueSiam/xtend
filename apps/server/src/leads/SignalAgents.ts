import {
  type AgentRun,
  type AgentSuggestion,
  type Candidate,
  LeadsError,
  type SignalAgent,
  type SignalAgentInput,
  isLeadsError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as Assist from "../ai/Assist.ts";
import * as Events from "../events/Events.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as PeopleStore from "./PeopleStore.ts";

const TICK = "60 seconds";
const SEARCH_LIMIT = 50;
const NEW_ACCOUNT_MS = 90 * 86_400_000;

/** The scores bot check: tiny follow-everyone accounts, blank bios, accounts under 90 days. */
const looksLikeBot = (
  p: {
    readonly followers: number;
    readonly following: number;
    readonly bio: string;
    readonly createdAt: string | null;
  },
  nowMs: number,
): boolean =>
  (p.followers < 50 && p.following > 10 * p.followers) ||
  p.bio.trim() === "" ||
  (p.createdAt !== null && nowMs - Date.parse(p.createdAt) < NEW_ACCOUNT_MS);

interface AgentRow {
  readonly id: number;
  readonly name: string;
  readonly query: string;
  readonly min_followers: number;
  readonly interval_minutes: number;
  readonly last_run: string | null;
  readonly enabled: number;
  readonly scoring_prompt: string;
  readonly lang: string | null;
  readonly exclude_bots: number;
  readonly notify_min_score: number | null;
  readonly list_id: number | null;
}

interface RunRow {
  readonly id: number;
  readonly agent_id: number;
  readonly at: string;
  readonly found: number;
  readonly inserted: number;
  readonly cost_usd: number;
  readonly error: string | null;
}

const toRun = (r: RunRow): AgentRun => ({
  id: r.id,
  agentId: r.agent_id,
  at: r.at,
  found: r.found,
  inserted: r.inserted,
  costUsd: r.cost_usd,
  error: r.error,
});

const Scores = Schema.Array(
  Schema.Struct({
    handle: Schema.String,
    score: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
    reason: Schema.String,
  }),
);

const Suggestions = Schema.Array(
  Schema.Struct({ name: Schema.String, query: Schema.String, scoringPrompt: Schema.String }),
);

/** Saved searches that run on a schedule, score the authors they find and file them as people. */
export class SignalAgents extends Context.Service<
  SignalAgents,
  {
    readonly list: Effect.Effect<ReadonlyArray<SignalAgent>, LeadsError>;
    readonly upsert: (input: SignalAgentInput) => Effect.Effect<SignalAgent, LeadsError>;
    readonly run: (id: number) => Effect.Effect<AgentRun, LeadsError>;
    readonly suggest: Effect.Effect<ReadonlyArray<AgentSuggestion>, LeadsError>;
    /** Runs every enabled agent whose interval has elapsed. The layer calls this every minute. */
    readonly tick: Effect.Effect<void, LeadsError>;
  }
>()("xtend/leads/SignalAgents") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const people = yield* PeopleStore.PeopleStore;
  const events = yield* Events.Events;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const fail = (operation: string) => (cause: unknown) =>
    isLeadsError(cause)
      ? cause
      : new LeadsError({ operation, detail: String(cause).slice(0, 200), cause });

  const lastRun = (agentId: number) =>
    sql<RunRow>`SELECT * FROM agent_runs WHERE agent_id = ${agentId} ORDER BY id DESC LIMIT 1`.pipe(
      Effect.map((rows) => (rows[0] === undefined ? null : toRun(rows[0]))),
    );

  const toAgent = (r: AgentRow) =>
    Effect.map(lastRun(r.id), (run): SignalAgent => ({
      id: r.id,
      name: r.name,
      query: r.query,
      minFollowers: r.min_followers,
      intervalMinutes: r.interval_minutes,
      enabled: r.enabled === 1,
      scoringPrompt: r.scoring_prompt,
      lang: r.lang,
      excludeBots: r.exclude_bots === 1,
      notifyMinScore: r.notify_min_score,
      listId: r.list_id,
      lastRun: run,
    }));

  const byId = (id: number) =>
    sql<AgentRow>`SELECT * FROM agents WHERE id = ${id}`.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? Effect.fail(`agent ${id} not found`) : Effect.succeed(rows[0]),
      ),
    );

  const list =
    sql<AgentRow>`SELECT * FROM agents WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY id DESC`.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, toAgent)),
      Effect.mapError(fail("agentsList")),
    );

  const upsert = Effect.fn("SignalAgents.upsert")(
    function* (a: SignalAgentInput) {
      const enabled = a.enabled ? 1 : 0;
      const bots = a.excludeBots ? 1 : 0;
      const rows =
        a.id === undefined
          ? yield* sql<{ id: number }>`
              INSERT INTO agents (name, query, min_followers, interval_minutes, enabled, scoring_prompt, lang, exclude_bots, notify_min_score, list_id)
              VALUES (${a.name}, ${a.query}, ${a.minFollowers}, ${a.intervalMinutes}, ${enabled}, ${a.scoringPrompt}, ${a.lang}, ${bots}, ${a.notifyMinScore}, ${a.listId})
              RETURNING id`
          : yield* sql<{ id: number }>`
              UPDATE agents SET name = ${a.name}, query = ${a.query}, min_followers = ${a.minFollowers},
                interval_minutes = ${a.intervalMinutes}, enabled = ${enabled}, scoring_prompt = ${a.scoringPrompt},
                lang = ${a.lang}, exclude_bots = ${bots}, notify_min_score = ${a.notifyMinScore}, list_id = ${a.listId}
              WHERE id = ${a.id} RETURNING id`;
      if (rows[0] === undefined) return yield* Effect.fail(`agent ${a.id} not found`);
      return yield* toAgent(yield* byId(rows[0].id));
    },
    Effect.mapError(fail("agentUpsert")),
  );

  // One search page, new authors scored in one model call, rows filed under the agent's name.
  const runAgent = Effect.fn("SignalAgents.runAgent")(function* (agent: AgentRow) {
    const at = yield* now;
    const nowMs = Date.parse(at);
    const known = yield* people.knownHandles;
    const page = yield* x.searchPosts(agent.query, {
      mode: "latest",
      limit: SEARCH_LIMIT,
      purpose: `leads.agent.${agent.name}`,
    });
    const byHandle = new Map<string, { post: string; candidate: Candidate }>();
    for (const p of page.items) {
      const key = p.author.handle.toLowerCase();
      if (known.has(key) || byHandle.has(key)) continue;
      if ((p.author.followers ?? 0) < agent.min_followers) continue;
      if (agent.lang !== null && p.lang !== agent.lang) continue;
      byHandle.set(key, {
        post: p.text,
        candidate: {
          handle: p.author.handle,
          name: p.author.name,
          userId: p.author.userId,
          followers: p.author.followers,
          bio: "",
        },
      });
    }
    let found = [...byHandle.values()];
    // A run inside the search's 30-minute cache paid nothing for it.
    let costUsd = page.fromCache ? 0 : XClient.RATE_CARD.searchPage;
    // The bot check needs following, bio and account age, which only a profile has.
    if (agent.exclude_bots === 1) {
      costUsd += found.length * XClient.RATE_CARD.scraperProfile;
      const profiled = yield* Effect.forEach(found, (f) =>
        Effect.map(x.profile(f.candidate.handle, `leads.agent.${agent.name}`), (p) =>
          p === null || looksLikeBot(p, nowMs)
            ? null
            : {
                post: f.post,
                candidate: {
                  ...f.candidate,
                  userId: p.userId,
                  followers: p.followers,
                  bio: p.bio,
                },
              },
        ),
      );
      found = profiled.filter((f) => f !== null);
    }
    let scored: ReadonlyArray<Candidate> = [];
    if (found.length > 0) {
      const { keywords } = yield* settings.get;
      const scores = yield* assist.generate({
        task: "leads.agentScore",
        instructions: `Score each author 0-100 as a lead for the user. Scoring guidance from the user: ${agent.scoring_prompt || "(none)"}. Give one short reason each. Return one entry per handle.`,
        input: {
          keywords,
          authors: found.map((f) => ({
            handle: f.candidate.handle,
            followers: f.candidate.followers,
            post: f.post,
          })),
        },
        output: Scores,
      });
      // Models often answer "@Alice" for alice.
      const byScore = new Map(scores.map((s) => [s.handle.replace(/^@/, "").toLowerCase(), s]));
      scored = found.map((f) => {
        const s = byScore.get(f.candidate.handle.toLowerCase());
        return { ...f.candidate, score: s?.score ?? null, bio: s?.reason || f.candidate.bio };
      });
    }
    const ids = yield* people.addMany(scored, `agent:${agent.name}`, agent.list_id ?? undefined);
    const min = agent.notify_min_score;
    if (min !== null)
      for (const [i, id] of ids.entries()) {
        const c = scored[i]!;
        if (id !== null && c.score !== undefined && c.score !== null && c.score >= min)
          yield* events.publish({
            type: "lead_found",
            payload: { personId: id, handle: c.handle, score: c.score, agent: agent.name },
          });
      }
    // shortcut: a profile read does not say whether the cache served it, so those are logged at the quoted rate.
    return { at, found: found.length, inserted: ids.filter((id) => id !== null).length, costUsd };
  });

  const record = Effect.fn("SignalAgents.record")(function* (
    agentId: number,
    r: { at: string; found: number; inserted: number; costUsd: number; error: string | null },
  ) {
    const rows = yield* sql<RunRow>`
        INSERT INTO agent_runs (agent_id, at, found, inserted, cost_usd, error)
        VALUES (${agentId}, ${r.at}, ${r.found}, ${r.inserted}, ${r.costUsd}, ${r.error}) RETURNING *`;
    yield* sql`UPDATE agents SET last_run = ${r.at} WHERE id = ${agentId}`;
    return toRun(rows[0]!);
  });

  // Agents with a run in flight: "Run now" during a scheduled run, or a double click, must not pay twice.
  const running = new Set<number>();

  const runOnce = Effect.fn("SignalAgents.runOnce")(function* (id: number) {
    const agent = yield* byId(id);
    const at = yield* now;
    const result = yield* runAgent(agent).pipe(
      Effect.map((r) => ({ ...r, error: null })),
      Effect.catch((e) =>
        Effect.succeed({ at, found: 0, inserted: 0, costUsd: 0, error: String(e).slice(0, 300) }),
      ),
    );
    return yield* record(id, result);
  });

  const run = Effect.fn("SignalAgents.run")(
    function* (id: number) {
      if (running.has(id)) return yield* Effect.fail(`agent ${id} is already running`);
      running.add(id);
      return yield* runOnce(id).pipe(Effect.ensuring(Effect.sync(() => running.delete(id))));
    },
    Effect.mapError(fail("agentRun")),
  );

  const suggest = Effect.gen(function* () {
    const { keywords, voiceNotes } = yield* settings.get;
    return yield* assist.generate({
      task: "leads.agentSuggest",
      instructions:
        "Propose exactly 3 signal agents: saved X searches that surface people worth talking to for this account. Each has a short name, an X advanced-search query (use OR, min_faves:, -is:retweet where useful) and a one-paragraph scoring prompt describing who scores high.",
      input: { keywords, voiceNotes },
      output: Suggestions,
    });
  }).pipe(Effect.mapError(fail("agentSuggest")));

  const due = (id?: number) => sql<{ id: number }>`
    SELECT id FROM agents WHERE enabled = 1 AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
    AND (last_run IS NULL OR last_run <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || interval_minutes || ' minutes'))
    ${id === undefined ? sql`` : sql`AND id = ${id}`}`;

  const tick = Effect.gen(function* () {
    for (const { id } of yield* due()) {
      // Asked again per agent: while earlier agents ran, this one may have been disabled or run by hand.
      if (running.has(id) || (yield* due(id)).length === 0) continue;
      yield* run(id);
    }
  }).pipe(Effect.mapError(fail("agentTick")));

  return SignalAgents.of({ list, upsert, run, suggest, tick });
});

export const layer = Layer.effect(SignalAgents, make);

/** The minute scheduler. Failures are logged and the loop continues. */
export const layerScheduler = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* SignalAgents;
    yield* agents.tick.pipe(
      Effect.catchCause((cause) => Effect.logWarning("signal agents tick failed", cause)),
      Effect.repeat(Schedule.spaced(TICK)),
      Effect.forkScoped,
    );
  }),
).pipe(Layer.provide(layer));

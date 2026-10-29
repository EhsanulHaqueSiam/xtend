import {
  Action,
  AutomateError,
  Conditions,
  type PendingRequest,
  type PendingStatus,
  type Rule,
  type RuleInput,
  type RuleRun,
  type RuleRunStatus,
  Trigger,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

const RUNS_LIMIT = 200;
/** Runs kept per rule; older ones are dropped as new ones arrive. Lists show RUNS_LIMIT. */
const RUNS_KEPT = 1_000;

const TriggerJson = Schema.fromJsonString(Trigger);
const ActionJson = Schema.fromJsonString(Action);
const ConditionsJson = Schema.fromJsonString(Conditions);
const decodeTrigger = Schema.decodeUnknownSync(TriggerJson);
const encodeTrigger = Schema.encodeSync(TriggerJson);
const decodeAction = Schema.decodeUnknownSync(ActionJson);
const encodeAction = Schema.encodeSync(ActionJson);
const decodeConditions = Schema.decodeUnknownSync(ConditionsJson);
const encodeConditions = Schema.encodeSync(ConditionsJson);

/** What a trigger matched: a post to act on, an engager to message, or just a slot to dedupe on. */
export const Subject = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  /** When the subject came to be; wait and the within-hours condition measure from it. */
  at: Schema.optional(Schema.String),
  postId: Schema.optional(Schema.String),
  /** The own post an ask-first request showed; approving it acts on this post, whatever ranks first by then. */
  pinnedPostId: Schema.optional(Schema.String),
  post: Schema.optional(
    Schema.Struct({
      hasLink: Schema.Boolean,
      isReply: Schema.Boolean,
      authorFollowers: Schema.NullOr(Schema.Number),
    }),
  ),
  engager: Schema.optional(
    Schema.Struct({
      userId: Schema.String,
      handle: Schema.String,
      name: Schema.String,
      followers: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type Subject = typeof Subject.Type;
const SubjectJson = Schema.fromJsonString(Subject);
const decodeSubject = Schema.decodeUnknownSync(SubjectJson);
const encodeSubject = Schema.encodeSync(SubjectJson);

/** The inverse of an ok run, scheduled by undoAfterHours. Engine-internal, never a rule Action. */
export const Undo = Schema.Struct({
  kind: Schema.Literals(["unlike", "unrepost", "unfollow", "delete_post"]),
  xId: Schema.String,
});
export type Undo = typeof Undo.Type;
const UndoJson = Schema.fromJsonString(Undo);
const decodeUndo = Schema.decodeUnknownSync(UndoJson);
const encodeUndo = Schema.encodeSync(UndoJson);

interface RuleRow {
  readonly id: number;
  readonly name: string;
  readonly enabled: number;
  readonly condition_json: string;
  readonly conditions_json: string;
  readonly wait_minutes: number;
  readonly action_json: string;
  readonly budget_usd_day: number;
  readonly spent_usd_day: number;
  readonly spent_day: string;
  readonly budget_usd_month: number;
  readonly spent_usd_month: number;
  readonly spent_month: string;
  readonly undo_after_hours: number | null;
  readonly ask_first: number;
  readonly dry_run: number;
  readonly webhook_secret: string;
  readonly created_at: string;
}

interface RunRow {
  readonly id: number;
  readonly rule_id: number;
  readonly at: string;
  readonly subject_id: string;
  readonly status: RuleRunStatus;
  readonly detail: string;
  readonly cost_usd: number;
  readonly x_id: string | null;
}

interface PendingRow {
  readonly id: number;
  readonly rule_id: number;
  readonly rule_name: string;
  readonly subject_id: string;
  readonly subject_json: string;
  readonly description: string;
  readonly cost_usd: number;
  readonly created_at: string;
  readonly status: typeof PendingStatus.Type;
}

const toRun = (r: RunRow): RuleRun => ({
  id: r.id,
  ruleId: r.rule_id,
  at: r.at,
  subjectId: r.subject_id,
  status: r.status,
  detail: r.detail,
  costUsd: r.cost_usd,
  xId: r.x_id,
});

export interface RunInput {
  readonly ruleId: number;
  readonly subjectId: string;
  readonly status: RuleRunStatus;
  readonly detail: string;
  readonly costUsd: number;
  readonly xId?: string | null;
}

export interface Pending extends PendingRequest {
  readonly subject: Subject;
}

export interface DueUndo {
  readonly id: number;
  readonly ruleId: number;
  readonly undo: Undo;
}

/** Rules, their run log, the per-subject dedupe table, per-rule spend, the approval queue, scheduled undos and webhook events. */
export class RuleStore extends Context.Service<
  RuleStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Rule>, AutomateError>;
    readonly get: (id: number) => Effect.Effect<Rule, AutomateError>;
    readonly upsert: (input: RuleInput) => Effect.Effect<Rule, AutomateError>;
    readonly remove: (id: number) => Effect.Effect<void, AutomateError>;
    /**
     * The secret of a webhook-triggered rule in any account: senders outside the app do not
     * know which account is current. Other triggers read as not found.
     */
    readonly webhook: (
      id: number,
    ) => Effect.Effect<{ readonly secret: string; readonly enabled: boolean }, AutomateError>;
    readonly firedSubjects: (ruleId: number) => Effect.Effect<ReadonlySet<string>, AutomateError>;
    /**
     * Appends the run row. Only an ok run marks the subject fired; the cost of an ok or failed
     * run counts against the rule's day and month, a dry run's only says what it would have
     * spent. A skipped, dry or free failed run that repeats the subject's last outcome returns
     * that row instead, so a rule held back every minute logs it once.
     */
    readonly recordRun: (input: RunInput) => Effect.Effect<RuleRun, AutomateError>;
    /** Counts spend that has no run row, such as a trigger poll, against the rule's day and month. */
    readonly addSpend: (ruleId: number, costUsd: number) => Effect.Effect<void, AutomateError>;
    /** Marks subjects a once-per-tick action covered, or a dismissed request closed, without a run row each. */
    readonly markFired: (
      ruleId: number,
      subjectIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, AutomateError>;
    /** Opens a subject marked fired before its action ran, when the action never reached X. */
    readonly unmarkFired: (ruleId: number, subjectId: string) => Effect.Effect<void, AutomateError>;
    readonly runs: (filter: {
      readonly ruleId?: number | undefined;
      readonly status?: RuleRunStatus | undefined;
    }) => Effect.Effect<ReadonlyArray<RuleRun>, AutomateError>;
    readonly createPending: (input: {
      readonly ruleId: number;
      readonly subject: Subject;
      readonly description: string;
      readonly costUsd: number;
    }) => Effect.Effect<Pending, AutomateError>;
    readonly pending: (id: number) => Effect.Effect<Pending, AutomateError>;
    readonly pendingList: Effect.Effect<ReadonlyArray<Pending>, AutomateError>;
    /** Subjects of a rule with a request still open, so a tick does not queue them twice. */
    readonly openPendingSubjects: (
      ruleId: number,
    ) => Effect.Effect<ReadonlySet<string>, AutomateError>;
    readonly settlePending: (
      id: number,
      status: "approved" | "dismissed",
      runId: number | null,
    ) => Effect.Effect<void, AutomateError>;
    readonly scheduleUndo: (
      ruleId: number,
      dueAt: string,
      undo: Undo,
    ) => Effect.Effect<void, AutomateError>;
    /** The current account's due undos; another account's wait until it is current, since X acts as this one. */
    readonly dueUndos: (nowIso: string) => Effect.Effect<ReadonlyArray<DueUndo>, AutomateError>;
    readonly settleUndo: (
      id: number,
      status: "done" | "failed",
    ) => Effect.Effect<void, AutomateError>;
    readonly recordWebhook: (
      ruleId: number,
      bodyJson: string,
    ) => Effect.Effect<number, AutomateError>;
    readonly webhookEvents: (
      ruleId: number,
      sinceIso: string,
    ) => Effect.Effect<ReadonlyArray<{ readonly id: number; readonly at: string }>, AutomateError>;
  }
>()("xtend/automate/RuleStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* SettingsStore.SettingsStore;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  // The caps' day and month are the user's, in settings.timeZone, like the global budget's.
  const period = Effect.gen(function* () {
    const { timeZone } = yield* settings.get;
    const day = DateTime.formatIsoDate(
      DateTime.setZone(yield* DateTime.now, SettingsStore.zoneOf(timeZone)),
    );
    return { day, month: day.slice(0, 7) };
  });
  const fail = (operation: string) => (cause: unknown) =>
    new AutomateError({ operation, detail: String(cause).slice(0, 200), cause });

  const toRule = (r: RuleRow, at: { readonly day: string; readonly month: string }): Rule => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    trigger: decodeTrigger(r.condition_json),
    conditions: decodeConditions(r.conditions_json),
    waitMinutes: r.wait_minutes,
    action: decodeAction(r.action_json),
    budgetUsdDay: r.budget_usd_day,
    budgetUsdMonth: r.budget_usd_month,
    undoAfterHours: r.undo_after_hours,
    askFirst: r.ask_first === 1,
    dryRun: r.dry_run === 1,
    spentUsdDay: r.spent_day === at.day ? r.spent_usd_day : 0,
    spentUsdMonth: r.spent_month === at.month ? r.spent_usd_month : 0,
    createdAt: r.created_at,
  });

  // Another account's rule reads as missing: acting on it would use this account's X connection.
  const row = (id: number) =>
    Effect.flatMap(
      sql<RuleRow>`SELECT * FROM rules WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`,
      (rows) =>
        rows[0] === undefined ? Effect.fail(`rule ${id} not found`) : Effect.succeed(rows[0]),
    );
  const byId = (id: number) =>
    Effect.map(Effect.all([row(id), period]), ([r, at]) => toRule(r, at));

  const list = Effect.gen(function* () {
    const at = yield* period;
    const rows =
      yield* sql<RuleRow>`SELECT * FROM rules WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY id DESC`;
    return rows.map((r) => toRule(r, at));
  }).pipe(Effect.mapError(fail("rulesList")));

  const get = Effect.fn("RuleStore.get")(byId, Effect.mapError(fail("ruleGet")));

  const upsert = Effect.fn("RuleStore.upsert")(
    function* (r: RuleInput) {
      const at = yield* now;
      const enabled = r.enabled ? 1 : 0;
      const dry = r.dryRun ? 1 : 0;
      const ask = r.askFirst ? 1 : 0;
      const trigger = encodeTrigger(r.trigger);
      const action = encodeAction(r.action);
      const conditions = encodeConditions(r.conditions);
      const rows =
        r.id === undefined
          ? yield* sql<{ id: number }>`
              INSERT INTO rules (name, enabled, trigger, condition_json, conditions_json, wait_minutes, action_json,
                budget_usd_day, budget_usd_month, undo_after_hours, ask_first, dry_run, webhook_secret, created_at)
              VALUES (${r.name}, ${enabled}, ${r.trigger.kind}, ${trigger}, ${conditions}, ${r.waitMinutes}, ${action},
                ${r.budgetUsdDay}, ${r.budgetUsdMonth}, ${r.undoAfterHours}, ${ask}, ${dry}, lower(hex(randomblob(16))), ${at})
              RETURNING id`
          : yield* sql<{ id: number }>`
              UPDATE rules SET name = ${r.name}, enabled = ${enabled}, trigger = ${r.trigger.kind},
                condition_json = ${trigger}, conditions_json = ${conditions}, wait_minutes = ${r.waitMinutes},
                action_json = ${action}, budget_usd_day = ${r.budgetUsdDay}, budget_usd_month = ${r.budgetUsdMonth},
                undo_after_hours = ${r.undoAfterHours}, ask_first = ${ask}, dry_run = ${dry}
              WHERE id = ${r.id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)} RETURNING id`;
      if (rows[0] === undefined) return yield* Effect.fail(`rule ${r.id} not found`);
      return yield* byId(rows[0].id);
    },
    Effect.mapError(fail("ruleUpsert")),
  );

  const remove = Effect.fn("RuleStore.remove")(
    function* (id: number) {
      yield* sql`DELETE FROM rules WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
    },
    Effect.mapError(fail("ruleDelete")),
  );

  const webhook = Effect.fn("RuleStore.webhook")(
    function* (id: number) {
      const rows = yield* sql<{ webhook_secret: string; enabled: number }>`
        SELECT webhook_secret, enabled FROM rules WHERE id = ${id} AND trigger = 'webhook'`;
      if (rows[0] === undefined) return yield* Effect.fail(`webhook rule ${id} not found`);
      return { secret: rows[0].webhook_secret, enabled: rows[0].enabled === 1 };
    },
    Effect.mapError(fail("webhook")),
  );

  const firedSubjects = Effect.fn("RuleStore.firedSubjects")(
    function* (ruleId: number) {
      const rows = yield* sql<{ subject_id: string }>`
        SELECT subject_id FROM rule_fired WHERE rule_id = ${ruleId}`;
      return new Set(rows.map((r) => r.subject_id));
    },
    Effect.mapError(fail("firedSubjects")),
  );

  const spend = (ruleId: number, costUsd: number) =>
    Effect.flatMap(
      period,
      ({ day, month }) => sql`
      UPDATE rules SET
        spent_usd_day = CASE WHEN spent_day = ${day} THEN spent_usd_day + ${costUsd} ELSE ${costUsd} END,
        spent_day = ${day},
        spent_usd_month = CASE WHEN spent_month = ${month} THEN spent_usd_month + ${costUsd} ELSE ${costUsd} END,
        spent_month = ${month}
      WHERE id = ${ruleId}`,
    );

  const addSpend = Effect.fn("RuleStore.addSpend")(
    function* (ruleId: number, costUsd: number) {
      if (costUsd > 0) yield* spend(ruleId, costUsd);
    },
    Effect.mapError(fail("addSpend")),
  );

  const recordRun = Effect.fn("RuleStore.recordRun")(
    function* (input: RunInput) {
      const at = yield* now;
      // Failed runs carry what X charged before the failure; it still counts against the rule.
      const spent = input.status === "ok" || input.status === "failed" ? input.costUsd : 0;
      if (spent === 0 && input.status !== "ok" && input.status !== "pending") {
        const last = (yield* sql<RunRow>`
          SELECT * FROM rule_runs WHERE rule_id = ${input.ruleId} AND subject_id = ${input.subjectId}
          ORDER BY id DESC LIMIT 1`)[0];
        if (
          last !== undefined &&
          last.status === input.status &&
          last.detail === input.detail &&
          last.cost_usd === input.costUsd
        )
          return toRun(last);
      }
      if (input.status === "ok")
        yield* sql`INSERT OR IGNORE INTO rule_fired (rule_id, subject_id, at) VALUES (${input.ruleId}, ${input.subjectId}, ${at})`;
      if (spent > 0) yield* spend(input.ruleId, spent);
      const rows = yield* sql<RunRow>`
        INSERT INTO rule_runs (rule_id, at, subject_id, status, detail, cost_usd, x_id)
        VALUES (${input.ruleId}, ${at}, ${input.subjectId}, ${input.status}, ${input.detail}, ${input.costUsd}, ${input.xId ?? null})
        RETURNING *`;
      yield* sql`
        DELETE FROM rule_runs WHERE rule_id = ${input.ruleId} AND id <= (
          SELECT id FROM rule_runs WHERE rule_id = ${input.ruleId} ORDER BY id DESC LIMIT 1 OFFSET ${RUNS_KEPT})`;
      return toRun(rows[0]!);
    },
    Effect.mapError(fail("recordRun")),
  );

  const markFired = Effect.fn("RuleStore.markFired")(
    function* (ruleId: number, subjectIds: ReadonlyArray<string>) {
      const at = yield* now;
      for (const id of subjectIds)
        yield* sql`INSERT OR IGNORE INTO rule_fired (rule_id, subject_id, at) VALUES (${ruleId}, ${id}, ${at})`;
    },
    Effect.mapError(fail("markFired")),
  );

  const unmarkFired = Effect.fn("RuleStore.unmarkFired")(
    function* (ruleId: number, subjectId: string) {
      yield* sql`DELETE FROM rule_fired WHERE rule_id = ${ruleId} AND subject_id = ${subjectId}`;
    },
    Effect.mapError(fail("unmarkFired")),
  );

  const runs = Effect.fn("RuleStore.runs")(
    function* (filter: {
      readonly ruleId?: number | undefined;
      readonly status?: RuleRunStatus | undefined;
    }) {
      const byRule = filter.ruleId === undefined ? sql`` : sql`AND rule_id = ${filter.ruleId}`;
      const byStatus = filter.status === undefined ? sql`` : sql`AND status = ${filter.status}`;
      const rows = yield* sql<RunRow>`
        SELECT * FROM rule_runs WHERE rule_id IN (SELECT id FROM rules WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)})
          ${byRule} ${byStatus} ORDER BY id DESC LIMIT ${RUNS_LIMIT}`;
      return rows.map(toRun);
    },
    Effect.mapError(fail("runsList")),
  );

  const toPending = (r: PendingRow): Pending => ({
    id: r.id,
    ruleId: r.rule_id,
    ruleName: r.rule_name,
    subjectId: r.subject_id,
    subject: decodeSubject(r.subject_json),
    description: r.description,
    costUsd: r.cost_usd,
    createdAt: r.created_at,
    status: r.status,
  });

  const pendingRow = (id: number) =>
    Effect.flatMap(
      sql<PendingRow>`
        SELECT p.*, r.name AS rule_name FROM pending_requests p JOIN rules r ON r.id = p.rule_id
        WHERE p.id = ${id} AND r.account_id = ${sql.literal(CURRENT_ACCOUNT)}`,
      (rows) =>
        rows[0] === undefined
          ? Effect.fail(`pending request ${id} not found`)
          : Effect.succeed(toPending(rows[0])),
    );

  const createPending = Effect.fn("RuleStore.createPending")(
    function* (input: {
      readonly ruleId: number;
      readonly subject: Subject;
      readonly description: string;
      readonly costUsd: number;
    }) {
      const at = yield* now;
      const rows = yield* sql<{ id: number }>`
        INSERT INTO pending_requests (rule_id, subject_id, subject_json, description, cost_usd, created_at)
        VALUES (${input.ruleId}, ${input.subject.id}, ${encodeSubject(input.subject)}, ${input.description}, ${input.costUsd}, ${at})
        RETURNING id`;
      return yield* pendingRow(rows[0]!.id);
    },
    Effect.mapError(fail("createPending")),
  );

  const pending = Effect.fn("RuleStore.pending")(pendingRow, Effect.mapError(fail("pending")));

  const pendingList = sql<PendingRow>`
    SELECT p.*, r.name AS rule_name FROM pending_requests p JOIN rules r ON r.id = p.rule_id
    WHERE p.status = 'pending' AND r.account_id = ${sql.literal(CURRENT_ACCOUNT)}
    ORDER BY p.id DESC LIMIT ${RUNS_LIMIT}`.pipe(
    Effect.map((rows) => rows.map(toPending)),
    Effect.mapError(fail("pendingList")),
  );

  const openPendingSubjects = Effect.fn("RuleStore.openPendingSubjects")(
    function* (ruleId: number) {
      const rows = yield* sql<{ subject_id: string }>`
        SELECT subject_id FROM pending_requests WHERE rule_id = ${ruleId} AND status = 'pending'`;
      return new Set(rows.map((r) => r.subject_id));
    },
    Effect.mapError(fail("openPendingSubjects")),
  );

  const settlePending = Effect.fn("RuleStore.settlePending")(
    function* (id: number, status: "approved" | "dismissed", runId: number | null) {
      yield* sql`UPDATE pending_requests SET status = ${status}, run_id = ${runId} WHERE id = ${id}`;
    },
    Effect.mapError(fail("settlePending")),
  );

  const scheduleUndo = Effect.fn("RuleStore.scheduleUndo")(
    function* (ruleId: number, dueAt: string, undo: Undo) {
      yield* sql`INSERT INTO scheduled_actions (rule_id, due_at, undo_json) VALUES (${ruleId}, ${dueAt}, ${encodeUndo(undo)})`;
    },
    Effect.mapError(fail("scheduleUndo")),
  );

  const dueUndos = Effect.fn("RuleStore.dueUndos")(
    function* (nowIso: string) {
      const rows = yield* sql<{ id: number; rule_id: number; undo_json: string }>`
        SELECT id, rule_id, undo_json FROM scheduled_actions
        WHERE status = 'due' AND due_at <= ${nowIso}
          AND rule_id IN (SELECT id FROM rules WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)})
        ORDER BY id`;
      return rows.map((r): DueUndo => ({
        id: r.id,
        ruleId: r.rule_id,
        undo: decodeUndo(r.undo_json),
      }));
    },
    Effect.mapError(fail("dueUndos")),
  );

  const settleUndo = Effect.fn("RuleStore.settleUndo")(
    function* (id: number, status: "done" | "failed") {
      yield* sql`UPDATE scheduled_actions SET status = ${status} WHERE id = ${id}`;
    },
    Effect.mapError(fail("settleUndo")),
  );

  const recordWebhook = Effect.fn("RuleStore.recordWebhook")(
    function* (ruleId: number, bodyJson: string) {
      const at = yield* now;
      const rows = yield* sql<{ id: number }>`
        INSERT INTO webhook_events (rule_id, body_json, at) VALUES (${ruleId}, ${bodyJson}, ${at}) RETURNING id`;
      // The trigger only ever reads the newest RUNS_LIMIT calls, so older bodies are dead weight.
      yield* sql`
        DELETE FROM webhook_events WHERE rule_id = ${ruleId} AND id <= (
          SELECT id FROM webhook_events WHERE rule_id = ${ruleId} ORDER BY id DESC LIMIT 1 OFFSET ${RUNS_LIMIT})`;
      return rows[0]!.id;
    },
    Effect.mapError(fail("recordWebhook")),
  );

  const webhookEvents = Effect.fn("RuleStore.webhookEvents")(
    function* (ruleId: number, sinceIso: string) {
      return yield* sql<{ id: number; at: string }>`
        SELECT id, at FROM webhook_events WHERE rule_id = ${ruleId} AND at >= ${sinceIso} ORDER BY id DESC LIMIT ${RUNS_LIMIT}`;
    },
    Effect.mapError(fail("webhookEvents")),
  );

  return RuleStore.of({
    list,
    get,
    upsert,
    remove,
    webhook,
    firedSubjects,
    recordRun,
    addSpend,
    markFired,
    unmarkFired,
    runs,
    createPending,
    pending,
    pendingList,
    openPendingSubjects,
    settlePending,
    scheduleUndo,
    dueUndos,
    settleUndo,
    recordWebhook,
    webhookEvents,
  });
});

export const layer = Layer.effect(RuleStore, make);

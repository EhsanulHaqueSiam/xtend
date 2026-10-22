import {
  Action,
  AutomateError,
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

const RUNS_LIMIT = 200;

const TriggerJson = Schema.fromJsonString(Trigger);
const ActionJson = Schema.fromJsonString(Action);
const decodeTrigger = Schema.decodeUnknownSync(TriggerJson);
const encodeTrigger = Schema.encodeSync(TriggerJson);
const decodeAction = Schema.decodeUnknownSync(ActionJson);
const encodeAction = Schema.encodeSync(ActionJson);

interface RuleRow {
  readonly id: number;
  readonly name: string;
  readonly enabled: number;
  readonly condition_json: string;
  readonly action_json: string;
  readonly budget_usd_month: number;
  readonly spent_usd_month: number;
  readonly spent_month: string;
  readonly dry_run: number;
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
}

const toRun = (r: RunRow): RuleRun => ({
  id: r.id,
  ruleId: r.rule_id,
  at: r.at,
  subjectId: r.subject_id,
  status: r.status,
  detail: r.detail,
  costUsd: r.cost_usd,
});

export interface RunInput {
  readonly ruleId: number;
  readonly subjectId: string;
  readonly status: RuleRunStatus;
  readonly detail: string;
  readonly costUsd: number;
}

/** Rules, their run log, the per-subject dedupe table and the per-rule monthly spend. */
export class RuleStore extends Context.Service<
  RuleStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Rule>, AutomateError>;
    readonly get: (id: number) => Effect.Effect<Rule, AutomateError>;
    readonly upsert: (input: RuleInput) => Effect.Effect<Rule, AutomateError>;
    readonly remove: (id: number) => Effect.Effect<void, AutomateError>;
    readonly firedSubjects: (ruleId: number) => Effect.Effect<ReadonlySet<string>, AutomateError>;
    /**
     * Appends the run row. Only an ok run marks the subject fired and adds its cost to the
     * rule's month; skipped, failed and dry runs leave the subject open for the next tick.
     */
    readonly recordRun: (input: RunInput) => Effect.Effect<RuleRun, AutomateError>;
    /** Marks subjects a once-per-tick action covered without a run row each. */
    readonly markFired: (
      ruleId: number,
      subjectIds: ReadonlyArray<string>,
    ) => Effect.Effect<void, AutomateError>;
    readonly runs: (filter: {
      readonly ruleId?: number | undefined;
      readonly status?: RuleRunStatus | undefined;
    }) => Effect.Effect<ReadonlyArray<RuleRun>, AutomateError>;
  }
>()("xtend/automate/RuleStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const month = Effect.map(now, (iso) => iso.slice(0, 7));
  const fail = (operation: string) => (cause: unknown) =>
    new AutomateError({ operation, detail: String(cause).slice(0, 200), cause });

  const toRule = (r: RuleRow, currentMonth: string): Rule => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled === 1,
    trigger: decodeTrigger(r.condition_json),
    action: decodeAction(r.action_json),
    budgetUsdMonth: r.budget_usd_month,
    spentUsdMonth: r.spent_month === currentMonth ? r.spent_usd_month : 0,
    dryRun: r.dry_run === 1,
    createdAt: r.created_at,
  });

  const byId = (id: number) =>
    Effect.gen(function* () {
      const rows = yield* sql<RuleRow>`SELECT * FROM rules WHERE id = ${id}`;
      if (rows[0] === undefined) return yield* Effect.fail(`rule ${id} not found`);
      return toRule(rows[0], yield* month);
    });

  const list = Effect.gen(function* () {
    const m = yield* month;
    const rows = yield* sql<RuleRow>`SELECT * FROM rules ORDER BY id DESC`;
    return rows.map((r) => toRule(r, m));
  }).pipe(Effect.mapError(fail("rulesList")));

  const get = Effect.fn("RuleStore.get")(byId, Effect.mapError(fail("ruleGet")));

  const upsert = Effect.fn("RuleStore.upsert")(
    function* (r: RuleInput) {
      const at = yield* now;
      const enabled = r.enabled ? 1 : 0;
      const dry = r.dryRun ? 1 : 0;
      const trigger = encodeTrigger(r.trigger);
      const action = encodeAction(r.action);
      const rows =
        r.id === undefined
          ? yield* sql<{ id: number }>`
              INSERT INTO rules (name, enabled, trigger, condition_json, action_json, budget_usd_month, dry_run, created_at)
              VALUES (${r.name}, ${enabled}, ${r.trigger.kind}, ${trigger}, ${action}, ${r.budgetUsdMonth}, ${dry}, ${at})
              RETURNING id`
          : yield* sql<{ id: number }>`
              UPDATE rules SET name = ${r.name}, enabled = ${enabled}, trigger = ${r.trigger.kind},
                condition_json = ${trigger}, action_json = ${action},
                budget_usd_month = ${r.budgetUsdMonth}, dry_run = ${dry}
              WHERE id = ${r.id} RETURNING id`;
      return yield* byId(rows[0]!.id);
    },
    Effect.mapError(fail("ruleUpsert")),
  );

  const remove = Effect.fn("RuleStore.remove")(
    function* (id: number) {
      yield* sql`DELETE FROM rules WHERE id = ${id}`;
    },
    Effect.mapError(fail("ruleDelete")),
  );

  const firedSubjects = Effect.fn("RuleStore.firedSubjects")(
    function* (ruleId: number) {
      const rows = yield* sql<{ subject_id: string }>`
        SELECT subject_id FROM rule_fired WHERE rule_id = ${ruleId}`;
      return new Set(rows.map((r) => r.subject_id));
    },
    Effect.mapError(fail("firedSubjects")),
  );

  const recordRun = Effect.fn("RuleStore.recordRun")(
    function* (input: RunInput) {
      const at = yield* now;
      const m = yield* month;
      if (input.status === "ok")
        yield* sql`INSERT OR IGNORE INTO rule_fired (rule_id, subject_id, at) VALUES (${input.ruleId}, ${input.subjectId}, ${at})`;
      // Failed runs carry what X charged before the failure; it still counts against the rule.
      if (input.costUsd > 0)
        yield* sql`
          UPDATE rules SET
            spent_usd_month = CASE WHEN spent_month = ${m} THEN spent_usd_month + ${input.costUsd} ELSE ${input.costUsd} END,
            spent_month = ${m}
          WHERE id = ${input.ruleId}`;
      const rows = yield* sql<RunRow>`
        INSERT INTO rule_runs (rule_id, at, subject_id, status, detail, cost_usd)
        VALUES (${input.ruleId}, ${at}, ${input.subjectId}, ${input.status}, ${input.detail}, ${input.costUsd})
        RETURNING *`;
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

  const runs = Effect.fn("RuleStore.runs")(
    function* (filter: {
      readonly ruleId?: number | undefined;
      readonly status?: RuleRunStatus | undefined;
    }) {
      const byRule = filter.ruleId === undefined ? sql`` : sql`AND rule_id = ${filter.ruleId}`;
      const byStatus = filter.status === undefined ? sql`` : sql`AND status = ${filter.status}`;
      const rows = yield* sql<RunRow>`
        SELECT * FROM rule_runs WHERE 1 = 1 ${byRule} ${byStatus} ORDER BY id DESC LIMIT ${RUNS_LIMIT}`;
      return rows.map(toRun);
    },
    Effect.mapError(fail("runsList")),
  );

  return RuleStore.of({ list, get, upsert, remove, firedSubjects, recordRun, markFired, runs });
});

export const layer = Layer.effect(RuleStore, make);

import { describe, expect, it } from "@effect/vitest";
import type { RuleInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as RuleStore from "./RuleStore.ts";

const layerTest = RuleStore.layer.pipe(
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

const likeRule: RuleInput = {
  name: "like-hot",
  enabled: true,
  trigger: { kind: "post_crosses_threshold", metric: "views", threshold: 1000 },
  conditions: {},
  waitMinutes: 0,
  action: { kind: "auto_like" },
  budgetUsdDay: 1,
  budgetUsdMonth: 1,
  undoAfterHours: null,
  askFirst: false,
  dryRun: false,
};

describe("RuleStore", () => {
  it.effect("a rule's day and month caps roll over at the user's midnight, not UTC's", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      yield* (yield* SettingsStore.SettingsStore).update({ timeZone: "Australia/Sydney" });
      // Oct 31 21:00 in Sydney.
      yield* TestClock.setTime(Date.parse("2026-10-31T10:00:00.000Z"));
      const rule = yield* rules.upsert(likeRule);
      yield* rules.recordRun({
        ruleId: rule.id,
        subjectId: "a",
        status: "ok",
        detail: "like a",
        costUsd: 0.1,
      });
      // Nov 1 01:00 in Sydney, still Oct 31 in UTC: a new day and a new month for the caps.
      yield* TestClock.setTime(Date.parse("2026-10-31T14:00:00.000Z"));
      yield* rules.addSpend(rule.id, 0.05);
      const after = yield* rules.get(rule.id);
      expect(after.spentUsdDay).toBeCloseTo(0.05);
      expect(after.spentUsdMonth).toBeCloseTo(0.05);
      // Nov 2 00:30 in Sydney: the day turns over, the month keeps counting.
      yield* TestClock.setTime(Date.parse("2026-11-01T13:30:00.000Z"));
      const next = yield* rules.get(rule.id);
      expect([next.spentUsdDay, next.spentUsdMonth]).toEqual([0, 0.05]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a busy rule keeps its newest runs and webhook calls, not all of them", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      const sql = yield* SqlClient.SqlClient;
      const rule = yield* rules.upsert(likeRule);
      const other = yield* rules.upsert({ ...likeRule, name: "quiet" });
      const ok = (ruleId: number, subjectId: string) =>
        rules.recordRun({ ruleId, subjectId, status: "ok", detail: "", costUsd: 0 });
      yield* ok(other.id, "q");
      for (let i = 0; i < 1_002; i++) yield* ok(rule.id, `s${i}`);
      const stored = yield* sql<{ subject_id: string }>`
        SELECT subject_id FROM rule_runs WHERE rule_id = ${rule.id} ORDER BY id`;
      expect(stored).toHaveLength(1_000);
      expect([stored[0]?.subject_id, stored.at(-1)?.subject_id]).toEqual(["s2", "s1001"]);
      // The cap is per rule: another rule's history is untouched.
      expect((yield* rules.runs({ ruleId: other.id })).map((r) => r.subjectId)).toEqual(["q"]);
      // Dedupe lives apart from the log, so a dropped run's subject still never fires again.
      expect((yield* rules.firedSubjects(rule.id)).has("s0")).toBe(true);

      const calls: Array<number> = [];
      for (let i = 0; i < 202; i++) calls.push(yield* rules.recordWebhook(rule.id, "{}"));
      const events = yield* sql<{ id: number }>`
        SELECT id FROM webhook_events WHERE rule_id = ${rule.id} ORDER BY id`;
      expect(events.map((e) => e.id)).toEqual(calls.slice(2));
    }).pipe(Effect.provide(layerTest)),
  );
});

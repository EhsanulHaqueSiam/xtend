import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as RuleStore from "./RuleStore.ts";
import * as Webhooks from "./Webhooks.ts";

const layerTest = RuleStore.layer.pipe(Layer.provide(Sqlite.layerMemory));

describe("Webhooks", () => {
  it.live("accepts a body signed with the rule's secret and refuses anything else", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      const rule = yield* rules.upsert({
        name: "release",
        enabled: true,
        trigger: { kind: "webhook" },
        conditions: {},
        waitMinutes: 0,
        action: { kind: "notify", message: "shipped" },
        budgetUsdDay: 1,
        budgetUsdMonth: 1,
        undoAfterHours: null,
        askFirst: false,
        dryRun: false,
      });
      const secret = yield* rules.webhookSecret(rule.id);
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
      const body = '{"tag":"v1.2.0"}';

      const ok = yield* Webhooks.handleWebhook(
        rule.id,
        `sha256=${Webhooks.sign(secret, body)}`,
        body,
      );
      expect(ok.eventId).toBeGreaterThan(0);
      expect(
        (yield* rules.webhookEvents(rule.id, "2000-01-01T00:00:00.000Z")).map((e) => e.id),
      ).toEqual([ok.eventId]);

      const bad = yield* Effect.result(
        Webhooks.handleWebhook(rule.id, Webhooks.sign("other", body), body),
      );
      expect(bad._tag).toBe("Failure");
      const missing = yield* Effect.result(Webhooks.handleWebhook(rule.id, null, body));
      expect(missing._tag).toBe("Failure");
      // A changed body with the old signature is refused too.
      const tampered = yield* Effect.result(
        Webhooks.handleWebhook(rule.id, Webhooks.sign(secret, body), body + " "),
      );
      expect(tampered._tag).toBe("Failure");
      expect(yield* rules.webhookEvents(rule.id, "2000-01-01T00:00:00.000Z")).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );
});

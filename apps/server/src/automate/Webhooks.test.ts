import { describe, expect, it } from "@effect/vitest";
import type { RuleInput } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as RuleStore from "./RuleStore.ts";
import * as Webhooks from "./Webhooks.ts";

const layerTest = RuleStore.layer.pipe(
  Layer.provide(SettingsStore.layer),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest)),
);

const webhookRule: RuleInput = {
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
};
const SINCE = "2000-01-01T00:00:00.000Z";

describe("Webhooks", () => {
  it.live("accepts a body signed with the rule's secret and refuses anything else", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      const rule = yield* rules.upsert(webhookRule);
      const { secret } = yield* rules.webhook(rule.id);
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
      const body = '{"tag":"v1.2.0"}';

      const ok = yield* Webhooks.handleWebhook(
        rule.id,
        `sha256=${Webhooks.sign(secret, body)}`,
        body,
      );
      expect(ok.eventId).toBeGreaterThan(0);
      expect((yield* rules.webhookEvents(rule.id, SINCE)).map((e) => e.id)).toEqual([ok.eventId]);

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
      expect(yield* rules.webhookEvents(rule.id, SINCE)).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("refuses junk after a valid signature, an oversized body and a switched-off rule", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      const rule = yield* rules.upsert(webhookRule);
      const { secret } = yield* rules.webhook(rule.id);
      const body = '{"tag":"v1.2.0"}';
      const call = (signature: string, payload = body) =>
        Effect.result(Webhooks.handleWebhook(rule.id, signature, payload));

      // Hex decoding stops at the first non-hex character, so a suffix must not ride along.
      expect((yield* call(`${Webhooks.sign(secret, body)}zz`))._tag).toBe("Failure");
      expect((yield* call(Webhooks.sign(secret, body).toUpperCase()))._tag).toBe("Success");
      const huge = "x".repeat(Webhooks.MAX_BODY_CHARS + 1);
      expect((yield* call(Webhooks.sign(secret, huge), huge))._tag).toBe("Failure");
      // Calls to a switched-off rule are not kept: they would all fire when it is switched back on.
      yield* rules.upsert({ ...webhookRule, id: rule.id, enabled: false });
      expect((yield* call(Webhooks.sign(secret, body)))._tag).toBe("Failure");
      expect(yield* rules.webhookEvents(rule.id, SINCE)).toHaveLength(1);

      // Only a webhook rule has a webhook.
      const other = yield* rules.upsert({ ...webhookRule, trigger: { kind: "new_follower" } });
      expect((yield* Effect.result(rules.webhook(other.id)))._tag).toBe("Failure");
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("takes calls for a rule of an account that is not the current one", () =>
    Effect.gen(function* () {
      const rules = yield* RuleStore.RuleStore;
      const sql = yield* SqlClient.SqlClient;
      const rule = yield* rules.upsert(webhookRule);
      const { secret } = yield* rules.webhook(rule.id);
      // The sender cannot know which account the app has open.
      yield* sql`INSERT INTO accounts (id, handle, label, created_at) VALUES (2, 'ghost', 'Ghost', ${SINCE})`;
      yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
      const body = "{}";
      const { eventId } = yield* Webhooks.handleWebhook(rule.id, Webhooks.sign(secret, body), body);
      yield* sql`UPDATE settings SET current_account_id = 1 WHERE id = 1`;
      expect((yield* rules.webhookEvents(rule.id, SINCE)).map((e) => e.id)).toEqual([eventId]);
    }).pipe(Effect.provide(layerTest)),
  );
});

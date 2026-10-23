// @effect-diagnostics nodeBuiltinImport:off -- HMAC comes from the platform.
import * as NodeCrypto from "node:crypto";

import { AutomateError } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as RuleStore from "./RuleStore.ts";

export const WEBHOOK_PATH = (ruleId: number) => `/api/webhooks/${ruleId}`;

/** Hex HMAC-SHA256 of the raw body; senders put it in `X-Xtend-Signature`, with or without a `sha256=` prefix. */
export const sign = (secret: string, body: string) =>
  NodeCrypto.createHmac("sha256", secret).update(body).digest("hex");

const verify = (secret: string, body: string, signature: string | null): boolean => {
  if (signature === null) return false;
  const given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  const expected = Buffer.from(sign(secret, body), "hex");
  return given.length === expected.length && NodeCrypto.timingSafeEqual(given, expected);
};

/**
 * Records one signed webhook call as a trigger event for the rule; the engine
 * turns it into a subject on its next tick. http.ts mounts this on
 * `POST /api/webhooks/:ruleId` with the raw body and the signature header.
 */
export const handleWebhook = Effect.fn("Webhooks.handle")(function* (
  ruleId: number,
  signature: string | null,
  body: string,
) {
  const rules = yield* RuleStore.RuleStore;
  const secret = yield* rules.webhookSecret(ruleId);
  if (!verify(secret, body, signature))
    return yield* new AutomateError({
      operation: "webhook",
      detail: "bad signature",
      cause: null,
    });
  const eventId = yield* rules.recordWebhook(ruleId, body);
  return { eventId };
});

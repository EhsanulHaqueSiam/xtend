// @effect-diagnostics nodeBuiltinImport:off -- HMAC comes from the platform.
import * as NodeCrypto from "node:crypto";

import { AutomateError } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as RuleStore from "./RuleStore.ts";

export const WEBHOOK_PATH = (ruleId: number) => `/api/webhooks/${ruleId}`;

/** Bodies are stored per call; a trigger needs a ping, not a payload. */
export const MAX_BODY_CHARS = 64 * 1024;

/** Hex HMAC-SHA256 of the raw body; senders put it in `X-Xtend-Signature`, with or without a `sha256=` prefix. */
export const sign = (secret: string, body: string) =>
  NodeCrypto.createHmac("sha256", secret).update(body).digest("hex");

const verify = (secret: string, body: string, signature: string | null): boolean => {
  const hex = signature?.replace(/^sha256=/, "") ?? "";
  // Buffer.from(hex) stops at the first non-hex character, so a valid signature with junk after it would pass.
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  return NodeCrypto.timingSafeEqual(
    Buffer.from(hex, "hex"),
    Buffer.from(sign(secret, body), "hex"),
  );
};

const refuse = (detail: string) => new AutomateError({ operation: "webhook", detail, cause: null });

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
  if (body.length > MAX_BODY_CHARS) return yield* refuse("body too large");
  const { secret, enabled } = yield* rules.webhook(ruleId);
  if (!verify(secret, body, signature)) return yield* refuse("bad signature");
  // A switched-off rule takes no calls; stored ones would all fire the moment it is switched back on.
  if (!enabled) return yield* refuse(`rule ${ruleId} is disabled`);
  const eventId = yield* rules.recordWebhook(ruleId, body);
  return { eventId };
});

import { describe, expect, it } from "vite-plus/test";

import { isSecretKey, redactText } from "./redact.ts";

describe("redact", () => {
  it("names credentials by their last word, not by substring", () => {
    const secret = [
      "token",
      "auth_token",
      "tregToken",
      "x-treg-token",
      "http.request.header.authorization",
      "set-cookie",
      "cookies",
      "secret",
      "webhookSecret",
      "password",
      "bearer",
      "api_key",
      "apiKey",
      "assistKey",
      "private_key",
      "ct0",
      "twid",
      "kdt",
      "credential",
      "credentials",
      "sessionId",
      "session_id",
      "sessionToken",
      "sessionKey",
      "password_hash",
      "passwordHash",
      "refresh_token",
      "accessToken",
      "id_token",
      "client_secret",
      "csrf",
      "csrfToken",
      "x-csrf-token",
      "authToken",
    ];
    const harmless = [
      "tokenCount",
      "token_budget",
      "tokens",
      "tregTokenSet",
      "x.purpose",
      "keywords",
      "monthlyBudgetUsd",
      "key",
      "id",
      "userId",
      "hash",
      "session",
      "sessionCount",
      "passwordUpdatedAt",
    ];
    expect(secret.filter((key) => !isSecretKey(key))).toEqual([]);
    expect(harmless.filter(isSecretKey)).toEqual([]);
  });

  it("scrubs a megabyte in one pass, whatever its shape", () => {
    const mb = 1024 * 1024;
    // Each would take minutes with a pattern that backtracks quadratically.
    for (const text of [
      "a".repeat(mb),
      "a.".repeat(mb / 2),
      '"k":'.repeat(mb / 4),
      `ct0=${"v".repeat(mb)}`,
      `"secret": "${"x\\".repeat(mb / 2)}`,
    ])
      expect(redactText(text).length).toBeLessThanOrEqual(text.length);
    expect(redactText('cookie: auth_token=a1; ct0=b2, "kdt": "c3", authorization: Bearer d4')).toBe(
      'cookie: <redacted>; ct0=<redacted>, "kdt": "<redacted>", authorization: <redacted>',
    );
  });
});

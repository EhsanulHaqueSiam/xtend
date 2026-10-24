import { XApiError } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hash from "effect/Hash";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Budget from "../budget/Budget.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";

const TREG_BASE = "https://treg.to";
/**
 * A call treg has not answered by then is given up on, so a hung socket cannot hold a
 * reservation forever. It may still have been served, so like a silent answer it costs its quote.
 */
const CALL_TIMEOUT = Duration.minutes(2);
/** Refusals before any provider served the call (bad token, no balance, rate limited) are never billed. */
const UNBILLED_STATUSES: ReadonlySet<number> = new Set([401, 402, 429]);

const TregCliConfig = Schema.fromJsonString(Schema.Struct({ token: Schema.String }));
const decodeCliConfig = Schema.decodeUnknownEffect(TregCliConfig);
const JsonText = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeSync(JsonText);
const decodeJson = Schema.decodeUnknownEffect(JsonText);

export interface TregCall {
  /** Catalog id (`anyapi.x.search.posts`) or the team's own tool path (`x/2/tweets`). */
  readonly endpoint: string;
  readonly method?: "GET" | "POST" | "DELETE";
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  /** Screen or automation paying for the call; ends up in the spend meter. */
  readonly purpose: string;
  /** Serve from x_cache when a copy younger than this exists. Reads only. */
  readonly cacheFor?: Duration.Duration;
  /** Price treg quoted in the catalog; checked against the budget before the call. */
  readonly expectedCostUsd?: number;
}

export interface TregResponse {
  readonly status: number;
  readonly body: unknown;
  readonly costUsd: number;
  readonly cached: boolean;
}

/**
 * The one door to treg. Every external call goes through `call`, which finds
 * the token, checks the monthly budget, caches reads, and logs what it cost.
 * Nothing else in the service may hold a credential or talk to a provider.
 */
export class Treg extends Context.Service<
  Treg,
  {
    readonly call: (input: TregCall) => Effect.Effect<TregResponse, XApiError>;
    /** True when `call` with this input would be served from x_cache right now. */
    readonly isCached: (input: TregCall) => Effect.Effect<boolean>;
  }
>()("xtend/x/Treg") {}

/** What treg says it charged, or the quoted price when it says nothing; a silent call must not read as free. */
export const costOf = (
  headers: Record<string, string>,
  body: unknown,
  expected: number,
): { readonly costUsd: number; readonly source: "header" | "body" | "quote" } => {
  const header = headers["x-treg-cost-usd"] ?? headers["x-treg-cost"];
  if (header !== undefined && Number.isFinite(Number(header)))
    return { costUsd: Number(header), source: "header" };
  if (typeof body === "object" && body !== null) {
    const cost =
      (body as { costUsd?: unknown; cost_usd?: unknown }).costUsd ??
      (body as { cost_usd?: unknown }).cost_usd;
    if (typeof cost === "number") return { costUsd: cost, source: "body" };
  }
  return { costUsd: expected, source: "quote" };
};

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* SettingsStore.SettingsStore;
  const budget = yield* Budget.Budget;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const cliToken = Effect.gen(function* () {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    const text = yield* fs.readFileString(path.join(home, ".treg", "config.json"));
    return (yield* decodeCliConfig(text)).token;
  }).pipe(Effect.orElseSucceed(() => null));

  const token = Effect.gen(function* () {
    const stored = yield* settings.tregToken.pipe(Effect.orElseSucceed(() => null));
    return stored ?? process.env.XTEND_TREG_TOKEN ?? (yield* cliToken);
  });

  // Keyed by the token too: an own-account read (`x/2/users/me`, mentions) belongs to the X
  // connection behind one treg token, and a pasted new token must not be served the old one's.
  const cacheKey = (input: TregCall, auth: string | null) =>
    `${auth === null ? "-" : Hash.string(auth)} ${input.method ?? "GET"} ${input.endpoint} ${encodeJson(input.query ?? {})} ${encodeJson(input.body ?? null)}`;

  const readCache = (key: string, maxAge: Duration.Duration) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ body_json: string; fetched_at: string }>`
        SELECT body_json, fetched_at FROM x_cache WHERE cache_key = ${key}
      `;
      const hit = rows[0];
      if (hit === undefined) return null;
      const age = DateTime.distance(DateTime.makeUnsafe(hit.fetched_at), yield* DateTime.now);
      if (Duration.isGreaterThan(age, maxAge)) return null;
      return yield* decodeJson(hit.body_json);
    }).pipe(Effect.orElseSucceed(() => null));

  const writeCache = (key: string, body: unknown) =>
    Effect.gen(function* () {
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO x_cache (cache_key, body_json, fetched_at) VALUES (${key}, ${encodeJson(body)}, ${at})
        ON CONFLICT(cache_key) DO UPDATE SET body_json = excluded.body_json, fetched_at = excluded.fetched_at
      `;
    }).pipe(Effect.ignore);

  const isCached = (input: TregCall) => {
    const maxAge = input.cacheFor;
    if (maxAge === undefined) return Effect.succeed(false);
    return Effect.gen(function* () {
      return (yield* readCache(cacheKey(input, yield* token), maxAge)) !== null;
    });
  };

  // The HTTP exchange itself; what it cost comes back with the response so the budget can settle it.
  const exchange = Effect.fn("Treg.exchange")(function* (input: TregCall, auth: string) {
    const method = input.method ?? (input.body === undefined ? "GET" : "POST");
    const url = new URL(`/call/${input.endpoint}`, TREG_BASE);
    for (const [k, v] of Object.entries(input.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    let request = HttpClientRequest.make(method)(url.toString()).pipe(
      HttpClientRequest.setHeaders({ "X-Treg-Token": auth, Accept: "application/json" }),
    );
    if (input.body !== undefined) request = HttpClientRequest.bodyJsonUnsafe(request, input.body);

    const response = yield* http.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new XApiError({
            endpoint: input.endpoint,
            reason: "http",
            status: null,
            detail: String(cause).slice(0, 300),
          }),
      ),
    );
    // undefined: the body was cut off mid-read or is not JSON (a proxy's error page). An empty
    // body (a 204) is null.
    const read = yield* response.text.pipe(Effect.orElseSucceed(() => null));
    const text = read ?? "";
    const body: unknown =
      read === null
        ? undefined
        : read === ""
          ? null
          : yield* decodeJson(read).pipe(Effect.orElseSucceed(() => undefined));
    // A 5xx or a treg-side refusal (502 "whose_error: treg") is never billed, so the quote
    // fallback applies only to answers the provider actually served.
    const billed = response.status < 500 && !UNBILLED_STATUSES.has(response.status);
    const cost = costOf(response.headers, body, billed ? (input.expectedCostUsd ?? 0) : 0);
    if (cost.source === "quote" && cost.costUsd > 0)
      yield* Effect.logDebug("treg sent no cost; charged the quote").pipe(
        Effect.annotateLogs({ endpoint: input.endpoint, costUsd: cost.costUsd }),
      );
    return {
      value: { status: response.status, text, body, costUsd: cost.costUsd },
      costUsd: cost.costUsd,
    };
  });

  const call = Effect.fn("Treg.call")(function* (input: TregCall) {
    const auth = yield* token;
    const key = cacheKey(input, auth);
    if (input.cacheFor !== undefined) {
      const cached = yield* readCache(key, input.cacheFor);
      if (cached !== null) return { status: 200, body: cached, costUsd: 0, cached: true };
    }

    if (auth === null) {
      return yield* new XApiError({
        endpoint: input.endpoint,
        reason: "no_token",
        status: null,
        detail: "no treg token: paste one in Settings or run `treg login`",
      });
    }

    const expected = input.expectedCostUsd ?? 0;
    const answer = yield* budget
      .spend(
        {
          expectedUsd: expected,
          provider: "treg",
          endpoint: input.endpoint,
          purpose: input.purpose,
        },
        exchange(input, auth).pipe(
          Effect.timeoutOrElse({
            duration: CALL_TIMEOUT,
            orElse: () => Effect.succeed({ value: null, costUsd: expected }),
          }),
        ),
      )
      .pipe(
        Effect.catchTag("BudgetExceeded", (e) =>
          Effect.fail(
            new XApiError({
              endpoint: input.endpoint,
              reason: "budget",
              status: null,
              detail: e.message,
            }),
          ),
        ),
      );

    if (answer === null)
      return yield* new XApiError({
        endpoint: input.endpoint,
        reason: "http",
        status: null,
        detail: `treg did not answer in ${Duration.format(CALL_TIMEOUT)}; a write may still have gone through`,
      });
    const { status, text, body, costUsd } = answer;
    if (status >= 400) {
      return yield* new XApiError({
        endpoint: input.endpoint,
        reason: "provider",
        status,
        detail: text.slice(0, 500),
      });
    }
    // Served and billed but unreadable: cached, it would read as an empty page until it expired.
    if (body === undefined)
      return yield* new XApiError({
        endpoint: input.endpoint,
        reason: "decode",
        status,
        detail: `unreadable answer: ${text.slice(0, 200)}`,
      });
    if (input.cacheFor !== undefined) yield* writeCache(key, body);
    return { status, body, costUsd, cached: false };
  });

  return Treg.of({ call, isCached });
});

export const layer = Layer.effect(Treg, make);

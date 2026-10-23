import { type Candidate, type EngagementVia, XApiError } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Treg from "../x/Treg.ts";
import * as XClient from "../x/XClient.ts";

/**
 * X calls the shared XClient does not have yet: who engaged with a post, and the
 * own-account writes automations need (unrepost, follow and their inverses).
 * Talks to Treg directly; the catalog ids and own-tool paths are pinned here.
 */
const ENDPOINTS = {
  /** Scraper, no X connection needed, one price per page. */
  reposters: "tikhub.x.twitter-web-fetch-retweet-user-list",
  /** X's own API, priced per user returned, so the page is capped. */
  likers: (postId: string) => `x/2/tweets/${postId}/liking_users`,
} as const;

const LIKERS_MAX = 20;
const LIKER_USD = 0.01;
const REPOSTERS_PAGE_USD = 0.001;

export const engagersCostUsd = (via: EngagementVia) =>
  via === "like" ? LIKERS_MAX * LIKER_USD : REPOSTERS_PAGE_USD;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === "object" && v !== null ? (v as Json) : {});
const arr = (v: unknown): ReadonlyArray<unknown> => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;

/** X v2 `liking_users` rows and tikhub `retweets` rows, normalized to list candidates. */
const candidateFromRow = (row: unknown): Candidate | null => {
  const r = obj(row);
  const handle = (str(r.username) || str(r.screen_name)).toLowerCase();
  if (handle === "") return null;
  return {
    handle,
    name: str(r.name) || handle,
    userId: str(r.id) || str(r.user_id) || null,
    followers: int(obj(r.public_metrics).followers_count ?? r.followers_count),
    bio: str(r.description),
  };
};

export class XExtra extends Context.Service<
  XExtra,
  {
    readonly engagers: (
      postId: string,
      via: EngagementVia,
      purpose: string,
    ) => Effect.Effect<
      { readonly matches: ReadonlyArray<Candidate>; readonly costUsd: number },
      XApiError
    >;
    readonly unrepost: (postId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly unlike: (postId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly follow: (userId: string, purpose: string) => Effect.Effect<void, XApiError>;
    readonly unfollow: (userId: string, purpose: string) => Effect.Effect<void, XApiError>;
  }
>()("xtend/leads/XExtra") {}

const make = Effect.gen(function* () {
  const treg = yield* Treg.Treg;
  const x = yield* XClient.XClient;
  const rates = XClient.RATE_CARD;

  const engagers = Effect.fn("XExtra.engagers")(function* (
    postId: string,
    via: EngagementVia,
    purpose: string,
  ) {
    if (via === "repost") {
      const response = yield* treg.call({
        endpoint: ENDPOINTS.reposters,
        query: { tweet_id: postId },
        purpose,
        expectedCostUsd: REPOSTERS_PAGE_USD,
      });
      const rows = arr(obj(obj(response.body).data).retweets);
      return {
        matches: rows.map(candidateFromRow).filter((c) => c !== null),
        costUsd: response.costUsd,
      };
    }
    const response = yield* treg.call({
      endpoint: ENDPOINTS.likers(postId),
      query: { max_results: LIKERS_MAX, "user.fields": "description,public_metrics" },
      purpose,
      expectedCostUsd: engagersCostUsd("like"),
    });
    return {
      matches: arr(obj(response.body).data)
        .map(candidateFromRow)
        .filter((c) => c !== null),
      costUsd: response.costUsd,
    };
  });

  // Own-account writes need the connected user's id in the path, like XClient.like does.
  const me = (purpose: string) =>
    Effect.flatMap(x.me(purpose), (m) =>
      m === null
        ? Effect.fail(
            new XApiError({
              endpoint: "x",
              reason: "provider",
              status: null,
              detail: "no X account connected in treg; run `treg connections` and connect X",
            }),
          )
        : Effect.succeed(m.userId),
    );

  const own = (
    method: "POST" | "DELETE",
    path: (meId: string) => string,
    purpose: string,
    expectedCostUsd: number,
    body?: unknown,
  ) =>
    Effect.gen(function* () {
      const id = yield* me(purpose);
      yield* treg.call({ endpoint: `x/${path(id)}`, method, body, purpose, expectedCostUsd });
    });

  return XExtra.of({
    engagers,
    unrepost: (postId, purpose) =>
      own("DELETE", (id) => `2/users/${id}/retweets/${postId}`, purpose, rates.delete),
    unlike: (postId, purpose) =>
      own("DELETE", (id) => `2/users/${id}/likes/${postId}`, purpose, rates.delete),
    follow: (userId, purpose) =>
      own("POST", (id) => `2/users/${id}/following`, purpose, rates.follow, {
        target_user_id: userId,
      }),
    unfollow: (userId, purpose) =>
      own("DELETE", (id) => `2/users/${id}/following/${userId}`, purpose, rates.delete),
  });
});

export const layer = Layer.effect(XExtra, make);

import { EngageError, NicheProfile, type SentReply, XPost } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";

const PostJson = Schema.fromJsonString(XPost);
const decodePost = Schema.decodeUnknownSync(PostJson);
const encodePost = Schema.encodeSync(PostJson);
const HandlesJson = Schema.fromJsonString(NicheProfile.fields.handles);
const TopicsJson = Schema.fromJsonString(NicheProfile.fields.topics);

interface SentRow {
  readonly id: number;
  readonly target_post_id: string;
  readonly target_url: string;
  readonly target_handle: string;
  readonly text: string;
  readonly post_id: string | null;
  readonly error: string | null;
  readonly at: string;
  readonly attributed_followers: number;
}

const toSent = (r: SentRow): SentReply => ({
  id: r.id,
  targetPostId: r.target_post_id,
  targetUrl: r.target_url,
  targetHandle: r.target_handle,
  text: r.text,
  postId: r.post_id,
  error: r.error,
  at: r.at,
  attributedFollowers: r.attributed_followers,
});

const storeError = (cause: unknown) =>
  new EngageError({ operation: "store", detail: String(cause).slice(0, 300) });

/** Replies the user sent from Engage and mentions marked handled. SQL only. */
export class EngageStore extends Context.Service<
  EngageStore,
  {
    readonly recordReply: (
      input: Omit<SentReply, "id" | "at" | "attributedFollowers">,
    ) => Effect.Effect<SentReply, EngageError>;
    /** `engagerIds` are people who replied to the user; a new follower among them counts for a reply too. */
    readonly sentList: (
      engagerIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<SentReply>, EngageError>;
    /** Successful replies older than two days with no later reply to the same target. */
    readonly followUps: Effect.Effect<ReadonlyArray<SentReply>, EngageError>;
    readonly repliedPostIds: Effect.Effect<ReadonlySet<string>, EngageError>;
    readonly handledMentionIds: Effect.Effect<ReadonlySet<string>, EngageError>;
    readonly markHandled: (postId: string) => Effect.Effect<void, EngageError>;
    /** Mentions fetched from X so far, newest first. */
    readonly apiMentions: Effect.Effect<ReadonlyArray<XPost>, EngageError>;
    /** Highest mention id fetched; the next refresh asks X for newer ones only. */
    readonly latestApiMentionId: Effect.Effect<string | null, EngageError>;
    readonly storeApiMentions: (posts: ReadonlyArray<XPost>) => Effect.Effect<void, EngageError>;
    /** Latest Scores sample per handle, for the handles that have one. */
    readonly authorScores: (
      handles: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyMap<string, number>, EngageError>;
    /** Successful replies sent per target handle. */
    readonly repliesByAuthor: Effect.Effect<ReadonlyMap<string, number>, EngageError>;
    readonly nicheGet: Effect.Effect<NicheProfile, EngageError>;
    readonly nicheSet: (
      profile: Omit<NicheProfile, "updatedAt">,
    ) => Effect.Effect<NicheProfile, EngageError>;
  }
>()("xtend/engage/EngageStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const recordReply = Effect.fn("EngageStore.recordReply")(function* (
    input: Omit<SentReply, "id" | "at" | "attributedFollowers">,
  ) {
    const at = yield* now;
    const rows = yield* sql<{ id: number }>`
        INSERT INTO replies_sent (target_post_id, target_url, target_handle, text, post_id, error, at)
        VALUES (${input.targetPostId}, ${input.targetUrl}, ${input.targetHandle}, ${input.text}, ${input.postId}, ${input.error}, ${at})
        RETURNING id
      `;
    return { ...input, id: rows[0]!.id, at, attributedFollowers: 0 };
  }, Effect.mapError(storeError));

  // followers_seen is the leads area's table; reading it here beats a second follower snapshot.
  const sentList = Effect.fn("EngageStore.sentList")(function* (engagerIds: ReadonlyArray<string>) {
    const engagers = engagerIds.length === 0 ? sql`` : sql`OR f.user_id IN ${sql.in(engagerIds)}`;
    const rows = yield* sql<SentRow>`
      SELECT r.*, (
        SELECT COUNT(*) FROM followers_seen f
        WHERE f.first_seen_at >= r.at AND f.first_seen_at < datetime(r.at, '+1 day')
          AND (f.handle = r.target_handle ${engagers})
      ) AS attributed_followers
      FROM replies_sent r WHERE r.account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY r.id DESC LIMIT 200
    `;
    return rows.map(toSent);
  }, Effect.mapError(storeError));

  const followUps = Effect.gen(function* () {
    const cutoff = DateTime.formatIso(
      DateTime.subtractDuration(yield* DateTime.now, Duration.days(2)),
    );
    // shortcut: "no new interaction" means no later reply from us; checking X for the
    // author's answer would cost a read per target, upgrade when the inbox gets a refresh button.
    const rows = yield* sql<SentRow>`
      SELECT r.*, 0 AS attributed_followers FROM replies_sent r
      WHERE r.post_id IS NOT NULL AND r.at < ${cutoff} AND r.account_id = ${sql.literal(CURRENT_ACCOUNT)}
        AND NOT EXISTS (
          SELECT 1 FROM replies_sent later
          WHERE later.target_post_id = r.target_post_id AND later.id > r.id
        )
      ORDER BY r.id DESC LIMIT 100
    `;
    return rows.map(toSent);
  }).pipe(Effect.mapError(storeError));

  const repliedPostIds = sql<{ target_post_id: string }>`
    SELECT DISTINCT target_post_id FROM replies_sent WHERE post_id IS NOT NULL AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
  `.pipe(
    Effect.map((rows) => new Set(rows.map((r) => r.target_post_id))),
    Effect.mapError(storeError),
  );

  const handledMentionIds = sql<{ post_id: string }>`SELECT post_id FROM handled_mentions`.pipe(
    Effect.map((rows) => new Set(rows.map((r) => r.post_id))),
    Effect.mapError(storeError),
  );

  const markHandled = Effect.fn("EngageStore.markHandled")(function* (postId: string) {
    const at = yield* now;
    yield* sql`INSERT OR IGNORE INTO handled_mentions (post_id, at) VALUES (${postId}, ${at})`;
  }, Effect.mapError(storeError));

  const apiMentions = sql<{ post_json: string }>`
    SELECT post_json FROM api_mentions WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY CAST(post_id AS INTEGER) DESC LIMIT 200
  `.pipe(
    Effect.map((rows) => rows.map((r) => decodePost(r.post_json))),
    Effect.mapError(storeError),
  );

  const latestApiMentionId = sql<{ post_id: string }>`
    SELECT post_id FROM api_mentions WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY CAST(post_id AS INTEGER) DESC LIMIT 1
  `.pipe(
    Effect.map((rows) => rows[0]?.post_id ?? null),
    Effect.mapError(storeError),
  );

  const storeApiMentions = Effect.fn("EngageStore.storeApiMentions")(function* (
    posts: ReadonlyArray<XPost>,
  ) {
    const at = yield* now;
    for (const p of posts)
      yield* sql`INSERT OR REPLACE INTO api_mentions (post_id, post_json, fetched_at) VALUES (${p.postId}, ${encodePost(p)}, ${at})`;
  }, Effect.mapError(storeError));

  const authorScores = Effect.fn("EngageStore.authorScores")(function* (
    handles: ReadonlyArray<string>,
  ) {
    const scores = new Map<string, number>();
    if (handles.length === 0) return scores;
    // score_samples belongs to the scores area; one read here beats an rpc round trip to ourselves.
    const rows = yield* sql<{ handle: string; score: number }>`
      SELECT handle, score FROM score_samples
      WHERE handle IN ${sql.in(handles.map((h) => h.toLowerCase()))} ORDER BY at ASC
    `;
    for (const r of rows) scores.set(r.handle, r.score);
    return scores;
  }, Effect.mapError(storeError));

  const repliesByAuthor = sql<{ target_handle: string; n: number }>`
    SELECT target_handle, COUNT(*) AS n FROM replies_sent WHERE post_id IS NOT NULL AND account_id = ${sql.literal(CURRENT_ACCOUNT)} GROUP BY target_handle
  `.pipe(
    Effect.map((rows) => new Map(rows.map((r) => [r.target_handle, r.n]))),
    Effect.mapError(storeError),
  );

  const nicheGet = sql<{ handles_json: string; topics_json: string; updated_at: string }>`
    SELECT handles_json, topics_json, updated_at FROM niche_profile WHERE id = 1
  `.pipe(
    Effect.map((rows): NicheProfile => {
      const r = rows[0];
      return r === undefined
        ? { handles: [], topics: [], updatedAt: null }
        : {
            handles: Schema.decodeUnknownSync(HandlesJson)(r.handles_json),
            topics: Schema.decodeUnknownSync(TopicsJson)(r.topics_json),
            updatedAt: r.updated_at,
          };
    }),
    Effect.mapError(storeError),
  );

  const nicheSet = Effect.fn("EngageStore.nicheSet")(function* (
    profile: Omit<NicheProfile, "updatedAt">,
  ) {
    const at = yield* now;
    yield* sql`
      INSERT OR REPLACE INTO niche_profile (id, handles_json, topics_json, updated_at)
      VALUES (1, ${Schema.encodeSync(HandlesJson)(profile.handles)}, ${Schema.encodeSync(TopicsJson)(profile.topics)}, ${at})
    `;
    return { ...profile, updatedAt: at };
  }, Effect.mapError(storeError));

  return EngageStore.of({
    authorScores,
    repliesByAuthor,
    nicheGet,
    nicheSet,
    recordReply,
    sentList,
    followUps,
    repliedPostIds,
    handledMentionIds,
    markHandled,
    apiMentions,
    latestApiMentionId,
    storeApiMentions,
  });
});

export const layer = Layer.effect(EngageStore, make);

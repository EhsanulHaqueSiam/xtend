import { EngageError, type FollowUp, NicheProfile, type SentReply, XPost } from "@xtend/contracts";
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
const encodeIds = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

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
    /** Keeps the reply and the post it answered; `postId` null with `error` is a refused write. */
    readonly recordReply: (
      target: XPost,
      reply: Pick<SentReply, "text" | "postId" | "error">,
    ) => Effect.Effect<SentReply, EngageError>;
    /** `engagerIds` are people who replied to the user; a new follower among them counts for a reply too. */
    readonly sentList: (
      engagerIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<SentReply>, EngageError>;
    /** Successful replies older than two days, not closed, with no later reply to the same target. */
    readonly followUps: Effect.Effect<ReadonlyArray<FollowUp>, EngageError>;
    /** Marks a follow-up done or dismissed, or puts it back on the due list with null. */
    readonly closeFollowUp: (
      id: number,
      state: "done" | "dismissed" | null,
    ) => Effect.Effect<void, EngageError>;
    readonly repliedPostIds: Effect.Effect<ReadonlySet<string>, EngageError>;
    readonly handledMentionIds: Effect.Effect<ReadonlySet<string>, EngageError>;
    /** Marks a mention handled, or reopens it with `handled` false. */
    readonly setHandled: (postId: string, handled: boolean) => Effect.Effect<void, EngageError>;
    /** Records the incoming rows as announced for the current account; returns how many were not yet. */
    readonly announce: (postIds: ReadonlyArray<string>) => Effect.Effect<number, EngageError>;
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
    target: XPost,
    reply: Pick<SentReply, "text" | "postId" | "error">,
  ) {
    const at = yield* now;
    const row = {
      targetPostId: target.postId,
      targetUrl: target.url,
      targetHandle: target.author.handle,
      ...reply,
    };
    const rows = yield* sql<{ id: number }>`
        INSERT INTO replies_sent (target_post_id, target_url, target_handle, text, post_id, error, at, target_json)
        VALUES (${row.targetPostId}, ${row.targetUrl}, ${row.targetHandle}, ${row.text}, ${row.postId}, ${row.error}, ${at}, ${encodePost(target)})
        RETURNING id
      `;
    return { ...row, id: rows[0]!.id, at, attributedFollowers: 0 };
  }, Effect.mapError(storeError));

  // followers_seen is the leads area's table; reading it here beats a second follower snapshot.
  // The window end is formatted like the stored ISO stamps: datetime()'s "YYYY-MM-DD HH:MM:SS"
  // sorts below every "YYYY-MM-DDT..." of that day, which cut the window at midnight.
  const sentList = Effect.fn("EngageStore.sentList")(function* (engagerIds: ReadonlyArray<string>) {
    const engagers = engagerIds.length === 0 ? sql`` : sql`OR f.user_id IN ${sql.in(engagerIds)}`;
    const rows = yield* sql<SentRow>`
      SELECT r.*, (
        SELECT COUNT(*) FROM followers_seen f
        WHERE f.account_id = r.account_id
          AND f.first_seen_at >= r.at
          AND f.first_seen_at < strftime('%Y-%m-%dT%H:%M:%fZ', r.at, '+1 day')
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
    const rows = yield* sql<SentRow & { readonly target_json: string | null }>`
      SELECT r.*, 0 AS attributed_followers FROM replies_sent r
      WHERE r.post_id IS NOT NULL AND r.at < ${cutoff} AND r.account_id = ${sql.literal(CURRENT_ACCOUNT)}
        AND r.follow_up IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM replies_sent later
          WHERE later.target_post_id = r.target_post_id AND later.id > r.id
            AND later.account_id = r.account_id
        )
      ORDER BY r.id DESC LIMIT 100
    `;
    return rows.map((r): FollowUp =>
      Object.assign(toSent(r), {
        target: r.target_json === null ? null : decodePost(r.target_json),
      }),
    );
  }).pipe(Effect.mapError(storeError));

  const closeFollowUp = Effect.fn("EngageStore.closeFollowUp")(function* (
    id: number,
    state: "done" | "dismissed" | null,
  ) {
    yield* sql`UPDATE replies_sent SET follow_up = ${state} WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

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

  const setHandled = Effect.fn("EngageStore.setHandled")(function* (
    postId: string,
    handled: boolean,
  ) {
    const at = yield* now;
    yield* handled
      ? sql`INSERT OR IGNORE INTO handled_mentions (post_id, at) VALUES (${postId}, ${at})`
      : sql`DELETE FROM handled_mentions WHERE post_id = ${postId}`;
  }, Effect.mapError(storeError));

  const announce = Effect.fn("EngageStore.announce")(function* (postIds: ReadonlyArray<string>) {
    if (postIds.length === 0) return 0;
    // One statement, so of two inbox reads racing over a row only one counts it.
    const fresh = yield* sql`
      INSERT OR IGNORE INTO announced_mentions (account_id, post_id)
      SELECT ${sql.literal(CURRENT_ACCOUNT)}, value FROM json_each(${encodeIds(postIds)})
      RETURNING post_id
    `;
    return fresh.length;
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
    SELECT handles_json, topics_json, updated_at FROM niche_profile WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}
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
      INSERT OR REPLACE INTO niche_profile (account_id, handles_json, topics_json, updated_at)
      VALUES (${sql.literal(CURRENT_ACCOUNT)}, ${Schema.encodeSync(HandlesJson)(profile.handles)}, ${Schema.encodeSync(TopicsJson)(profile.topics)}, ${at})
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
    closeFollowUp,
    repliedPostIds,
    handledMentionIds,
    setHandled,
    announce,
    apiMentions,
    latestApiMentionId,
    storeApiMentions,
  });
});

export const layer = Layer.effect(EngageStore, make);

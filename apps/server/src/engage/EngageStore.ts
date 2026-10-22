import { EngageError, type SentReply, XPost } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const PostJson = Schema.fromJsonString(XPost);
const decodePost = Schema.decodeUnknownSync(PostJson);
const encodePost = Schema.encodeSync(PostJson);

interface SentRow {
  readonly id: number;
  readonly target_post_id: string;
  readonly target_url: string;
  readonly target_handle: string;
  readonly text: string;
  readonly post_id: string | null;
  readonly error: string | null;
  readonly at: string;
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
});

const storeError = (cause: unknown) =>
  new EngageError({ operation: "store", detail: String(cause).slice(0, 300) });

/** Replies the user sent from Engage and mentions marked handled. SQL only. */
export class EngageStore extends Context.Service<
  EngageStore,
  {
    readonly recordReply: (
      input: Omit<SentReply, "id" | "at">,
    ) => Effect.Effect<SentReply, EngageError>;
    readonly sentList: Effect.Effect<ReadonlyArray<SentReply>, EngageError>;
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
  }
>()("xtend/engage/EngageStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const recordReply = Effect.fn("EngageStore.recordReply")(function* (
    input: Omit<SentReply, "id" | "at">,
  ) {
    const at = yield* now;
    const rows = yield* sql<{ id: number }>`
        INSERT INTO replies_sent (target_post_id, target_url, target_handle, text, post_id, error, at)
        VALUES (${input.targetPostId}, ${input.targetUrl}, ${input.targetHandle}, ${input.text}, ${input.postId}, ${input.error}, ${at})
        RETURNING id
      `;
    return { ...input, id: rows[0]!.id, at };
  }, Effect.mapError(storeError));

  const sentList = sql<SentRow>`SELECT * FROM replies_sent ORDER BY id DESC LIMIT 200`.pipe(
    Effect.map((rows) => rows.map(toSent)),
    Effect.mapError(storeError),
  );

  const followUps = Effect.gen(function* () {
    const cutoff = DateTime.formatIso(
      DateTime.subtractDuration(yield* DateTime.now, Duration.days(2)),
    );
    // shortcut: "no new interaction" means no later reply from us; checking X for the
    // author's answer would cost a read per target, upgrade when the inbox gets a refresh button.
    const rows = yield* sql<SentRow>`
      SELECT r.* FROM replies_sent r
      WHERE r.post_id IS NOT NULL AND r.at < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM replies_sent later
          WHERE later.target_post_id = r.target_post_id AND later.id > r.id
        )
      ORDER BY r.id DESC LIMIT 100
    `;
    return rows.map(toSent);
  }).pipe(Effect.mapError(storeError));

  const repliedPostIds = sql<{ target_post_id: string }>`
    SELECT DISTINCT target_post_id FROM replies_sent WHERE post_id IS NOT NULL
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
    SELECT post_json FROM api_mentions ORDER BY CAST(post_id AS INTEGER) DESC LIMIT 200
  `.pipe(
    Effect.map((rows) => rows.map((r) => decodePost(r.post_json))),
    Effect.mapError(storeError),
  );

  const latestApiMentionId = sql<{ post_id: string }>`
    SELECT post_id FROM api_mentions ORDER BY CAST(post_id AS INTEGER) DESC LIMIT 1
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

  return EngageStore.of({
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

import {
  type ObservationBatch,
  type ObservationListRecentInput,
  type ObservationListRecentResult,
  type ObservationRecordResult,
  ObservationStoreError,
  type ObservedPostSummary,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

const DEFAULT_LIST_LIMIT = 50;

interface ObservedPostRow {
  readonly post_id: string;
  readonly text: string;
  readonly created_at: string;
  readonly is_reply: number;
  readonly has_media: number;
  readonly has_link: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly observations: number;
  readonly user_id: string;
  readonly handle: string;
  readonly name: string;
  readonly followers: number | null;
  readonly verified: number;
  readonly views: number | null;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
}

const summaryFromRow = (row: ObservedPostRow): ObservedPostSummary => ({
  postId: row.post_id,
  author: {
    userId: row.user_id,
    handle: row.handle,
    name: row.name,
    followers: row.followers,
    verified: row.verified === 1,
  },
  text: row.text,
  createdAt: row.created_at,
  isReply: row.is_reply === 1,
  hasMedia: row.has_media === 1,
  hasLink: row.has_link === 1,
  metrics: {
    views: row.views,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    quotes: row.quotes,
    bookmarks: row.bookmarks,
  },
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  observations: row.observations,
});

export class ObservationStore extends Context.Service<
  ObservationStore,
  {
    /** Upserts authors and posts, appends one metrics row per post. Idempotent per (post, observedAt). */
    readonly record: (
      batch: ObservationBatch,
    ) => Effect.Effect<ObservationRecordResult, ObservationStoreError>;
    readonly listRecent: (
      input: ObservationListRecentInput,
    ) => Effect.Effect<ObservationListRecentResult, ObservationStoreError>;
  }
>()("xtend/observations/ObservationStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const record = Effect.fn("ObservationStore.record")(
    function* (batch: ObservationBatch) {
      yield* sql.withTransaction(
        Effect.forEach(
          batch.posts,
          (post) =>
            Effect.gen(function* () {
              const a = post.author;
              yield* sql`
                INSERT INTO observed_authors (user_id, handle, name, followers, verified, first_seen_at, last_seen_at)
                VALUES (${a.userId}, ${a.handle}, ${a.name}, ${a.followers}, ${a.verified ? 1 : 0}, ${batch.observedAt}, ${batch.observedAt})
                ON CONFLICT(user_id) DO UPDATE SET
                  handle = excluded.handle,
                  name = excluded.name,
                  followers = COALESCE(excluded.followers, observed_authors.followers),
                  verified = excluded.verified,
                  last_seen_at = MAX(observed_authors.last_seen_at, excluded.last_seen_at)
              `;
              yield* sql`
                INSERT INTO observed_posts (post_id, author_id, text, created_at, is_reply, has_media, has_link, first_seen_at, last_seen_at, observations)
                VALUES (${post.postId}, ${a.userId}, ${post.text}, ${post.createdAt}, ${post.isReply ? 1 : 0}, ${post.hasMedia ? 1 : 0}, ${post.hasLink ? 1 : 0}, ${batch.observedAt}, ${batch.observedAt}, 1)
                ON CONFLICT(post_id) DO UPDATE SET
                  text = excluded.text,
                  last_seen_at = MAX(observed_posts.last_seen_at, excluded.last_seen_at),
                  observations = observed_posts.observations + 1
              `;
              const m = post.metrics;
              yield* sql`
                INSERT OR IGNORE INTO post_metrics (post_id, observed_at, source, viewer_handle, views, likes, reposts, replies, quotes, bookmarks)
                VALUES (${post.postId}, ${batch.observedAt}, ${batch.source}, ${batch.viewerHandle}, ${m.views}, ${m.likes}, ${m.reposts}, ${m.replies}, ${m.quotes}, ${m.bookmarks})
              `;
            }),
          { discard: true },
        ),
      );
      return { posts: batch.posts.length };
    },
    Effect.mapError((cause) => new ObservationStoreError({ operation: "record", cause })),
  );

  const listRecent = Effect.fn("ObservationStore.listRecent")(
    function* (input: ObservationListRecentInput) {
      const limit = input.limit ?? DEFAULT_LIST_LIMIT;
      const authorFilter =
        input.authorHandle === undefined ? sql`` : sql`AND a.handle = ${input.authorHandle}`;
      const rows = yield* sql<ObservedPostRow>`
        SELECT p.post_id, p.text, p.created_at, p.is_reply, p.has_media, p.has_link,
               p.first_seen_at, p.last_seen_at, p.observations,
               a.user_id, a.handle, a.name, a.followers, a.verified,
               m.views, m.likes, m.reposts, m.replies, m.quotes, m.bookmarks
        FROM observed_posts p
        JOIN observed_authors a ON a.user_id = p.author_id
        JOIN post_metrics m ON m.post_id = p.post_id
          AND m.observed_at = (SELECT MAX(observed_at) FROM post_metrics WHERE post_id = p.post_id)
        WHERE 1 = 1 ${authorFilter}
        ORDER BY p.last_seen_at DESC, p.created_at DESC
        LIMIT ${limit}
      `;
      return { posts: rows.map(summaryFromRow) };
    },
    Effect.mapError((cause) => new ObservationStoreError({ operation: "listRecent", cause })),
  );

  return ObservationStore.of({ record, listRecent });
});

export const layer = Layer.effect(ObservationStore, make);

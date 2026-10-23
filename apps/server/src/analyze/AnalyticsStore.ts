import {
  type AccountPost,
  AnalyzeError,
  type PostKind,
  type ProfileSnapshot,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

interface PostRow {
  readonly post_id: string;
  readonly url: string;
  readonly text: string;
  readonly created_at: string;
  readonly kind: PostKind;
  readonly views: number | null;
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
  readonly bookmarks: number;
  readonly fetched_at: string;
}

const toPost = (r: PostRow): AccountPost => ({
  postId: r.post_id,
  url: r.url,
  text: r.text,
  createdAt: r.created_at,
  kind: r.kind,
  views: r.views,
  likes: r.likes,
  reposts: r.reposts,
  replies: r.replies,
  quotes: r.quotes,
  bookmarks: r.bookmarks,
});

/** Cached own posts, the daily profile snapshots ScoreStore writes, and a JSON cache for Assist and competitor results. */
export class AnalyticsStore extends Context.Service<
  AnalyticsStore,
  {
    readonly replacePosts: (
      handle: string,
      posts: ReadonlyArray<AccountPost>,
      fetchedAt: string,
    ) => Effect.Effect<void, AnalyzeError>;
    readonly listPosts: (
      handle: string,
    ) => Effect.Effect<
      { readonly posts: ReadonlyArray<AccountPost>; readonly fetchedAt: string | null },
      AnalyzeError
    >;
    readonly listSnapshots: (
      handle: string,
    ) => Effect.Effect<ReadonlyArray<ProfileSnapshot>, AnalyzeError>;
    readonly cacheGet: (key: string) => Effect.Effect<string | null, AnalyzeError>;
    readonly cacheSet: (
      key: string,
      bodyJson: string,
      at: string,
    ) => Effect.Effect<void, AnalyzeError>;
  }
>()("xtend/analyze/AnalyticsStore") {}

const fail = (operation: string) => (cause: { readonly message: string }) =>
  new AnalyzeError({ operation, detail: cause.message });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const replacePosts = Effect.fn("AnalyticsStore.replacePosts")(
    function* (handle: string, posts: ReadonlyArray<AccountPost>, fetchedAt: string) {
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM account_posts WHERE handle = ${handle}`;
          yield* Effect.forEach(
            posts,
            (p) => sql`
              INSERT OR REPLACE INTO account_posts (post_id, handle, url, text, created_at, kind, views, likes, reposts, replies, quotes, bookmarks, fetched_at)
              VALUES (${p.postId}, ${handle}, ${p.url}, ${p.text}, ${p.createdAt}, ${p.kind}, ${p.views}, ${p.likes}, ${p.reposts}, ${p.replies}, ${p.quotes}, ${p.bookmarks}, ${fetchedAt})
            `,
            { discard: true },
          );
        }),
      );
    },
    Effect.mapError(fail("replacePosts")),
  );

  const listPosts = Effect.fn("AnalyticsStore.listPosts")(
    function* (handle: string) {
      const rows = yield* sql<PostRow>`
        SELECT * FROM account_posts WHERE handle = ${handle} ORDER BY created_at DESC LIMIT 200
      `;
      return { posts: rows.map(toPost), fetchedAt: rows[0]?.fetched_at ?? null };
    },
    Effect.mapError(fail("listPosts")),
  );

  const listSnapshots = Effect.fn("AnalyticsStore.listSnapshots")(
    function* (handle: string) {
      return yield* sql<ProfileSnapshot>`
        SELECT day, followers, following, posts FROM profile_snapshots
        WHERE handle = ${handle} ORDER BY day ASC LIMIT 365
      `;
    },
    Effect.mapError(fail("listSnapshots")),
  );

  const cacheGet = Effect.fn("AnalyticsStore.cacheGet")(
    function* (key: string) {
      const rows = yield* sql<{ body_json: string }>`
        SELECT body_json FROM analysis_cache WHERE cache_key = ${key}
      `;
      return rows[0]?.body_json ?? null;
    },
    Effect.mapError(fail("cacheGet")),
  );

  const cacheSet = Effect.fn("AnalyticsStore.cacheSet")(
    function* (key: string, bodyJson: string, at: string) {
      yield* sql`
        INSERT INTO analysis_cache (cache_key, body_json, created_at) VALUES (${key}, ${bodyJson}, ${at})
        ON CONFLICT(cache_key) DO UPDATE SET body_json = excluded.body_json, created_at = excluded.created_at
      `;
    },
    Effect.mapError(fail("cacheSet")),
  );

  return AnalyticsStore.of({
    replacePosts,
    listPosts,
    listSnapshots,
    cacheGet,
    cacheSet,
  });
});

export const layer = Layer.effect(AnalyticsStore, make);

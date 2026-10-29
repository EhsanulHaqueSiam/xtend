import {
  type AuthorBand,
  type Collection,
  type HookPattern,
  LibraryError,
  type LibraryFilters,
  type LibraryPost,
  type Pick,
  type PostFormat,
  type SavedPost,
  XPost,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";

const PostJson = Schema.fromJsonString(XPost);
const decodePost = Schema.decodeUnknownSync(PostJson);
const encodePost = Schema.encodeSync(PostJson);

interface SavedRow {
  readonly id: number;
  readonly post_json: string;
  readonly note: string;
  readonly saved_at: string;
  /** Comma-joined collection ids from group_concat; empty when in none. */
  readonly collection_ids: string | null;
}

interface CollectionRow {
  readonly id: number;
  readonly name: string;
  readonly built_in: number;
  readonly posts: number;
  readonly created_at: string;
}

interface PickRow {
  readonly day: string;
  readonly keyword: string;
  readonly post_json: string;
  readonly why_it_works: string | null;
  readonly draft_json: string | null;
}

interface LibraryRow {
  readonly post_json: string;
  readonly format: PostFormat;
  readonly hook_pattern: HookPattern | null;
  readonly last_seen_at: string;
}

const toLibraryPost = (r: LibraryRow): LibraryPost => ({
  post: decodePost(r.post_json),
  format: r.format,
  hookPattern: r.hook_pattern,
  lastSeenAt: r.last_seen_at,
});

/** Format from the post's own flags; only `thread` needs the model. */
const formatOf = (post: XPost): PostFormat =>
  post.hasMedia ? "media" : post.hasLink ? "link" : "text";

const BAND_RANGE: Record<AuthorBand, readonly [number, number]> = {
  "under 10k": [0, 10_000],
  "10k to 100k": [10_000, 100_000],
  "100k to 1M": [100_000, 1_000_000],
  "1M+": [1_000_000, Number.MAX_SAFE_INTEGER],
};

const toSaved = (r: SavedRow): SavedPost => ({
  id: r.id,
  post: decodePost(r.post_json),
  note: r.note,
  savedAt: r.saved_at,
  collectionIds: (r.collection_ids ?? "")
    .split(",")
    .filter((s) => s !== "")
    .map(Number),
});

const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  builtIn: r.built_in === 1,
  posts: r.posts,
  createdAt: r.created_at,
});

const toPick = (r: PickRow): Pick => ({
  day: r.day,
  keyword: r.keyword,
  post: decodePost(r.post_json),
  whyItWorks: r.why_it_works,
});

const storeError = (cause: unknown) =>
  new LibraryError({ operation: "store", detail: String(cause).slice(0, 300) });

/** Saved posts, collections and daily picks. SQL only; no X or model calls. */
export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    readonly save: (input: {
      readonly post: XPost;
      readonly collectionId: number | null;
      readonly note?: string | undefined;
    }) => Effect.Effect<SavedPost, LibraryError>;
    readonly savedList: (input: {
      readonly collectionId?: number | undefined;
      readonly query?: string | undefined;
    }) => Effect.Effect<ReadonlyArray<SavedPost>, LibraryError>;
    readonly savedSetNote: (id: number, note: string) => Effect.Effect<void, LibraryError>;
    readonly savedDelete: (id: number) => Effect.Effect<void, LibraryError>;
    readonly getSavedPost: (postId: string) => Effect.Effect<SavedPost | null, LibraryError>;
    readonly collectionsList: Effect.Effect<ReadonlyArray<Collection>, LibraryError>;
    readonly collectionCreate: (name: string) => Effect.Effect<Collection, LibraryError>;
    readonly collectionRename: (id: number, name: string) => Effect.Effect<void, LibraryError>;
    readonly collectionDelete: (id: number) => Effect.Effect<void, LibraryError>;
    /** Unlinks the post from one of this account's own collections; Staff picks is read-only. */
    readonly collectionRemovePost: (
      collectionId: number,
      savedId: number,
    ) => Effect.Effect<void, LibraryError>;
    readonly picksForDay: (day: string) => Effect.Effect<ReadonlyArray<Pick>, LibraryError>;
    readonly pickFetchedKeywords: (
      day: string,
    ) => Effect.Effect<ReadonlyArray<string>, LibraryError>;
    /** Records the keyword as fetched and stores its posts; a post already picked today stays with its first keyword. */
    readonly picksRecord: (input: {
      readonly day: string;
      readonly keyword: string;
      readonly posts: ReadonlyArray<XPost>;
    }) => Effect.Effect<void, LibraryError>;
    readonly pickGet: (postId: string) => Effect.Effect<Pick | null, LibraryError>;
    readonly pickSetWhy: (postId: string, why: string) => Effect.Effect<void, LibraryError>;
    /** Adds posts to the archive or refreshes their metrics; a detected format and pattern survive. */
    readonly upsertPosts: (posts: ReadonlyArray<XPost>) => Effect.Effect<void, LibraryError>;
    readonly browse: (
      filters: LibraryFilters,
    ) => Effect.Effect<ReadonlyArray<LibraryPost>, LibraryError>;
    readonly libraryPost: (postId: string) => Effect.Effect<LibraryPost | null, LibraryError>;
    /** Archive posts no detection batch has labelled yet, most viewed first. */
    readonly undetected: (limit: number) => Effect.Effect<ReadonlyArray<LibraryPost>, LibraryError>;
    readonly undetectedCount: Effect.Effect<number, LibraryError>;
    readonly setPatterns: (
      labels: ReadonlyArray<{
        readonly postId: string;
        readonly format: PostFormat;
        readonly hookPattern: HookPattern;
      }>,
    ) => Effect.Effect<void, LibraryError>;
  }
>()("xtend/library/LibraryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const savedSelect = (where: Statement.Fragment, limit: number) => sql<SavedRow>`
    SELECT s.id, s.post_json, s.note, s.saved_at,
      (SELECT group_concat(cp.collection_id) FROM collection_posts cp WHERE cp.saved_id = s.id) AS collection_ids
    FROM saved_posts s
    ${where} AND s.account_id = ${sql.literal(CURRENT_ACCOUNT)}
    ORDER BY s.id DESC LIMIT ${limit}
  `;

  const save = Effect.fn("LibraryStore.save")(function* (input: {
    readonly post: XPost;
    readonly collectionId: number | null;
    readonly note?: string | undefined;
  }) {
    const at = yield* now;
    // An explicit account_id: the conflict check runs before 014's trigger would stamp one.
    const rows = yield* sql<{ id: number }>`
        INSERT INTO saved_posts (account_id, post_id, post_json, note, saved_at)
        VALUES (${sql.literal(CURRENT_ACCOUNT)}, ${input.post.postId}, ${encodePost(input.post)}, ${input.note ?? ""}, ${at})
        ON CONFLICT(account_id, post_id) DO UPDATE SET note = CASE WHEN excluded.note = '' THEN note ELSE excluded.note END
        RETURNING id
      `;
    const id = rows[0]!.id;
    if (input.collectionId !== null) {
      // Only into this account's own collections; another account's id links nothing.
      yield* sql`
        INSERT OR IGNORE INTO collection_posts (collection_id, saved_id)
        SELECT id, ${id} FROM collections WHERE id = ${input.collectionId} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
      `;
    }
    const saved = yield* savedSelect(sql`WHERE s.id = ${id}`, 1);
    return toSaved(saved[0]!);
  }, Effect.mapError(storeError));

  const savedList = Effect.fn("LibraryStore.savedList")(function* (input: {
    readonly collectionId?: number | undefined;
    readonly query?: string | undefined;
  }) {
    const query = input.query?.trim() ?? "";
    // What the user typed is literal text, so % and _ match themselves.
    const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    const matches = (column: Statement.Fragment, text = query) =>
      sql`${column} LIKE ${likeOf(text)} ESCAPE '\\'`;
    // The text, author and note the user sees; matching the raw JSON would hit its keys and URLs.
    const rows = yield* savedSelect(
      sql`WHERE 1 = 1
        ${input.collectionId === undefined ? sql`` : sql`AND s.id IN (SELECT saved_id FROM collection_posts WHERE collection_id = ${input.collectionId})`}
        ${
          query === ""
            ? sql``
            : sql`AND (${matches(sql`json_extract(s.post_json, '$.text')`)}
                OR ${matches(sql`json_extract(s.post_json, '$.author.handle')`, query.replace(/^@/, ""))}
                OR ${matches(sql`json_extract(s.post_json, '$.author.name')`)}
                OR ${matches(sql`s.note`)})`
        }`,
      200,
    );
    return rows.map(toSaved);
  }, Effect.mapError(storeError));

  const savedSetNote = Effect.fn("LibraryStore.savedSetNote")(function* (id: number, note: string) {
    yield* sql`UPDATE saved_posts SET note = ${note} WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

  const savedDelete = Effect.fn("LibraryStore.savedDelete")(function* (id: number) {
    yield* sql`DELETE FROM saved_posts WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

  const getSavedPost = Effect.fn("LibraryStore.getSavedPost")(function* (postId: string) {
    const rows = yield* savedSelect(sql`WHERE s.post_id = ${postId}`, 1);
    return rows.length === 0 ? null : toSaved(rows[0]!);
  }, Effect.mapError(storeError));

  // Each account's read-only Staff picks. Account 1's is the row 005 seeded; a later account gets
  // its own the first time picks land.
  const staffPicksId = Effect.gen(function* () {
    const found = yield* sql<{ id: number }>`
      SELECT id FROM collections WHERE built_in = 1 AND account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY id LIMIT 1
    `;
    if (found[0] !== undefined) return found[0].id;
    const created = yield* sql<{ id: number }>`
      INSERT INTO collections (account_id, name, built_in, created_at)
      VALUES (${sql.literal(CURRENT_ACCOUNT)}, 'Staff picks', 1, ${yield* now}) RETURNING id
    `;
    return created[0]!.id;
  }).pipe(Effect.mapError(storeError));

  // Counted as savedList lists them: a link 014-era picks made from another account's saved post
  // into account 1's Staff picks would otherwise count a post the list never shows.
  const collectionsList = sql<CollectionRow>`
    SELECT c.id, c.name, c.built_in, c.created_at,
      (SELECT COUNT(*) FROM collection_posts cp JOIN saved_posts s ON s.id = cp.saved_id
        WHERE cp.collection_id = c.id AND s.account_id = c.account_id) AS posts
    FROM collections c WHERE c.account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY c.built_in DESC, c.name
  `.pipe(
    Effect.map((rows) => rows.map(toCollection)),
    Effect.mapError(storeError),
  );

  const collectionCreate = Effect.fn("LibraryStore.collectionCreate")(function* (name: string) {
    const at = yield* now;
    const rows = yield* sql<{ id: number }>`
        INSERT INTO collections (name, created_at) VALUES (${name}, ${at}) RETURNING id
      `;
    return { id: rows[0]!.id, name, builtIn: false, posts: 0, createdAt: at };
  }, Effect.mapError(storeError));

  const collectionRename = Effect.fn("LibraryStore.collectionRename")(function* (
    id: number,
    name: string,
  ) {
    yield* sql`UPDATE collections SET name = ${name} WHERE id = ${id} AND built_in = 0 AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

  const collectionDelete = Effect.fn("LibraryStore.collectionDelete")(function* (id: number) {
    yield* sql`DELETE FROM collections WHERE id = ${id} AND built_in = 0 AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

  const collectionRemovePost = Effect.fn("LibraryStore.collectionRemovePost")(function* (
    collectionId: number,
    savedId: number,
  ) {
    yield* sql`
      DELETE FROM collection_posts WHERE saved_id = ${savedId} AND collection_id IN (
        SELECT id FROM collections WHERE id = ${collectionId} AND built_in = 0 AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
      )
    `;
  }, Effect.mapError(storeError));

  const picksForDay = Effect.fn("LibraryStore.picksForDay")(function* (day: string) {
    const rows = yield* sql<PickRow>`
        SELECT day, keyword, post_json, why_it_works, draft_json FROM picks WHERE day = ${day}
      `;
    return rows
      .map(toPick)
      .sort((a, b) => (b.post.metrics.views ?? 0) - (a.post.metrics.views ?? 0));
  }, Effect.mapError(storeError));

  const pickFetchedKeywords = Effect.fn("LibraryStore.pickFetchedKeywords")(function* (
    day: string,
  ) {
    const rows = yield* sql<{ keyword: string }>`
        SELECT keyword FROM pick_fetches WHERE day = ${day}
      `;
    return rows.map((r) => r.keyword);
  }, Effect.mapError(storeError));

  const picksRecord = Effect.fn("LibraryStore.picksRecord")(function* (input: {
    readonly day: string;
    readonly keyword: string;
    readonly posts: ReadonlyArray<XPost>;
  }) {
    // All or nothing: a keyword marked fetched with half its posts would never be fetched again.
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT OR IGNORE INTO pick_fetches (day, keyword) VALUES (${input.day}, ${input.keyword})`;
        const collectionId = yield* staffPicksId;
        for (const post of input.posts) {
          yield* sql`
            INSERT OR IGNORE INTO picks (day, keyword, post_id, post_json)
            VALUES (${input.day}, ${input.keyword}, ${post.postId}, ${encodePost(post)})
          `;
          // Staff picks mirrors the picks of the day.
          yield* save({ post, collectionId });
        }
      }),
    );
  }, Effect.mapError(storeError));

  const pickRow = (postId: string) =>
    sql<PickRow>`
      SELECT day, keyword, post_json, why_it_works, draft_json FROM picks
      WHERE post_id = ${postId} ORDER BY day DESC LIMIT 1
    `.pipe(Effect.map((rows) => rows[0] ?? null));

  const pickGet = Effect.fn("LibraryStore.pickGet")(function* (postId: string) {
    const row = yield* pickRow(postId);
    return row === null ? null : toPick(row);
  }, Effect.mapError(storeError));

  const pickSetWhy = Effect.fn("LibraryStore.pickSetWhy")(function* (postId: string, why: string) {
    yield* sql`UPDATE picks SET why_it_works = ${why} WHERE post_id = ${postId}`;
  }, Effect.mapError(storeError));

  const upsertPosts = Effect.fn("LibraryStore.upsertPosts")(function* (
    posts: ReadonlyArray<XPost>,
  ) {
    const at = yield* now;
    for (const post of posts) {
      yield* sql`
        INSERT INTO library_posts (account_id, post_id, post_json, author_followers, views, lang, year, format, first_seen_at, last_seen_at)
        VALUES (${sql.literal(CURRENT_ACCOUNT)}, ${post.postId}, ${encodePost(post)}, ${post.author.followers}, ${post.metrics.views}, ${post.lang}, ${Number(post.createdAt.slice(0, 4))}, ${formatOf(post)}, ${at}, ${at})
        ON CONFLICT(account_id, post_id) DO UPDATE SET
          post_json = excluded.post_json, author_followers = excluded.author_followers,
          views = excluded.views, last_seen_at = excluded.last_seen_at
      `;
    }
  }, Effect.mapError(storeError));

  const browse = Effect.fn("LibraryStore.browse")(function* (filters: LibraryFilters) {
    const band = filters.authorBand === undefined ? null : BAND_RANGE[filters.authorBand];
    const rows = yield* sql<LibraryRow>`
      SELECT post_json, format, hook_pattern, last_seen_at FROM library_posts
      WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}
        ${filters.minViews === undefined ? sql`` : sql`AND views >= ${filters.minViews}`}
        ${filters.format === undefined ? sql`` : sql`AND format = ${filters.format}`}
        ${filters.year === undefined ? sql`` : sql`AND year = ${filters.year}`}
        ${band === null ? sql`` : sql`AND author_followers >= ${band[0]} AND author_followers < ${band[1]}`}
        ${filters.lang === undefined ? sql`` : sql`AND lang = ${filters.lang}`}
        ${filters.hookPattern === undefined ? sql`` : sql`AND hook_pattern = ${filters.hookPattern}`}
      ORDER BY views DESC LIMIT 200
    `;
    return rows.map(toLibraryPost);
  }, Effect.mapError(storeError));

  const libraryPost = Effect.fn("LibraryStore.libraryPost")(function* (postId: string) {
    const rows = yield* sql<LibraryRow>`
      SELECT post_json, format, hook_pattern, last_seen_at FROM library_posts
      WHERE post_id = ${postId} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
    `;
    return rows.length === 0 ? null : toLibraryPost(rows[0]!);
  }, Effect.mapError(storeError));

  const undetected = Effect.fn("LibraryStore.undetected")(function* (limit: number) {
    const rows = yield* sql<LibraryRow>`
      SELECT post_json, format, hook_pattern, last_seen_at FROM library_posts
      WHERE hook_pattern IS NULL AND account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY views DESC LIMIT ${limit}
    `;
    return rows.map(toLibraryPost);
  }, Effect.mapError(storeError));

  const undetectedCount = sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM library_posts WHERE hook_pattern IS NULL AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
  `.pipe(
    Effect.map((rows) => rows[0]!.n),
    Effect.mapError(storeError),
  );

  const setPatterns = Effect.fn("LibraryStore.setPatterns")(function* (
    labels: ReadonlyArray<{
      readonly postId: string;
      readonly format: PostFormat;
      readonly hookPattern: HookPattern;
    }>,
  ) {
    for (const l of labels)
      yield* sql`UPDATE library_posts SET format = ${l.format}, hook_pattern = ${l.hookPattern} WHERE post_id = ${l.postId} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
  }, Effect.mapError(storeError));

  return LibraryStore.of({
    upsertPosts,
    browse,
    libraryPost,
    undetected,
    undetectedCount,
    setPatterns,
    save,
    savedList,
    savedSetNote,
    savedDelete,
    getSavedPost,
    collectionsList,
    collectionCreate,
    collectionRename,
    collectionDelete,
    collectionRemovePost,
    picksForDay,
    pickFetchedKeywords,
    picksRecord,
    pickGet,
    pickSetWhy,
  });
});

export const layer = Layer.effect(LibraryStore, make);

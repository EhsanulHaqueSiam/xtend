import { type Collection, LibraryError, type Pick, type SavedPost, XPost } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

const PostJson = Schema.fromJsonString(XPost);
const decodePost = Schema.decodeUnknownSync(PostJson);
const encodePost = Schema.encodeSync(PostJson);
const Blocks = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeBlocks = Schema.decodeUnknownSync(Blocks);
const encodeBlocks = Schema.encodeSync(Blocks);

/** The seeded read-only collection the picks of the day land in. */
export const STAFF_PICKS_ID = 1;

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

/** Saved posts, collections, daily picks and suggested drafts. SQL only; no X or model calls. */
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
    readonly pickDraftGet: (
      postId: string,
    ) => Effect.Effect<ReadonlyArray<string> | null, LibraryError>;
    readonly pickSetDraft: (
      postId: string,
      blocks: ReadonlyArray<string>,
    ) => Effect.Effect<void, LibraryError>;
    readonly suggestedDraftSave: (
      text: string,
      source: string,
    ) => Effect.Effect<{ readonly id: number }, LibraryError>;
  }
>()("xtend/library/LibraryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const savedSelect = (where: Statement.Fragment, limit: number) => sql<SavedRow>`
    SELECT s.id, s.post_json, s.note, s.saved_at,
      (SELECT group_concat(cp.collection_id) FROM collection_posts cp WHERE cp.saved_id = s.id) AS collection_ids
    FROM saved_posts s
    ${where}
    ORDER BY s.id DESC LIMIT ${limit}
  `;

  const save = Effect.fn("LibraryStore.save")(function* (input: {
    readonly post: XPost;
    readonly collectionId: number | null;
    readonly note?: string | undefined;
  }) {
    const at = yield* now;
    yield* sql`
        INSERT INTO saved_posts (post_id, post_json, note, saved_at)
        VALUES (${input.post.postId}, ${encodePost(input.post)}, ${input.note ?? ""}, ${at})
        ON CONFLICT(post_id) DO UPDATE SET note = CASE WHEN excluded.note = '' THEN note ELSE excluded.note END
      `;
    const rows = yield* sql<{ id: number }>`
        SELECT id FROM saved_posts WHERE post_id = ${input.post.postId}
      `;
    const id = rows[0]!.id;
    if (input.collectionId !== null) {
      yield* sql`INSERT OR IGNORE INTO collection_posts (collection_id, saved_id) VALUES (${input.collectionId}, ${id})`;
    }
    const saved = yield* savedSelect(sql`WHERE s.id = ${id}`, 1);
    return toSaved(saved[0]!);
  }, Effect.mapError(storeError));

  const savedList = Effect.fn("LibraryStore.savedList")(function* (input: {
    readonly collectionId?: number | undefined;
    readonly query?: string | undefined;
  }) {
    const like = `%${input.query ?? ""}%`;
    const rows =
      input.collectionId === undefined
        ? yield* savedSelect(sql`WHERE (s.post_json LIKE ${like} OR s.note LIKE ${like})`, 200)
        : yield* savedSelect(
            sql`WHERE s.id IN (SELECT saved_id FROM collection_posts WHERE collection_id = ${input.collectionId})`,
            200,
          );
    return rows.map(toSaved);
  }, Effect.mapError(storeError));

  const savedSetNote = Effect.fn("LibraryStore.savedSetNote")(function* (id: number, note: string) {
    yield* sql`UPDATE saved_posts SET note = ${note} WHERE id = ${id}`;
  }, Effect.mapError(storeError));

  const savedDelete = Effect.fn("LibraryStore.savedDelete")(function* (id: number) {
    yield* sql`DELETE FROM saved_posts WHERE id = ${id}`;
  }, Effect.mapError(storeError));

  const getSavedPost = Effect.fn("LibraryStore.getSavedPost")(function* (postId: string) {
    const rows = yield* savedSelect(sql`WHERE s.post_id = ${postId}`, 1);
    return rows.length === 0 ? null : toSaved(rows[0]!);
  }, Effect.mapError(storeError));

  const collectionsList = sql<CollectionRow>`
    SELECT c.id, c.name, c.built_in, c.created_at,
      (SELECT COUNT(*) FROM collection_posts cp WHERE cp.collection_id = c.id) AS posts
    FROM collections c ORDER BY c.built_in DESC, c.name
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
    yield* sql`UPDATE collections SET name = ${name} WHERE id = ${id} AND built_in = 0`;
  }, Effect.mapError(storeError));

  const collectionDelete = Effect.fn("LibraryStore.collectionDelete")(function* (id: number) {
    yield* sql`DELETE FROM collections WHERE id = ${id} AND built_in = 0`;
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
    yield* sql`INSERT OR IGNORE INTO pick_fetches (day, keyword) VALUES (${input.day}, ${input.keyword})`;
    for (const post of input.posts) {
      yield* sql`
          INSERT OR IGNORE INTO picks (day, keyword, post_id, post_json)
          VALUES (${input.day}, ${input.keyword}, ${post.postId}, ${encodePost(post)})
        `;
      // Staff picks mirrors the picks of the day.
      yield* save({ post, collectionId: STAFF_PICKS_ID });
    }
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

  const pickDraftGet = Effect.fn("LibraryStore.pickDraftGet")(function* (postId: string) {
    const row = yield* pickRow(postId);
    return row?.draft_json == null ? null : decodeBlocks(row.draft_json);
  }, Effect.mapError(storeError));

  const pickSetDraft = Effect.fn("LibraryStore.pickSetDraft")(function* (
    postId: string,
    blocks: ReadonlyArray<string>,
  ) {
    yield* sql`UPDATE picks SET draft_json = ${encodeBlocks(blocks)} WHERE post_id = ${postId}`;
  }, Effect.mapError(storeError));

  const suggestedDraftSave = Effect.fn("LibraryStore.suggestedDraftSave")(function* (
    text: string,
    source: string,
  ) {
    const at = yield* now;
    const rows = yield* sql<{ id: number }>`
        INSERT INTO suggested_drafts (text, source, created_at) VALUES (${text}, ${source}, ${at}) RETURNING id
      `;
    return { id: rows[0]!.id };
  }, Effect.mapError(storeError));

  return LibraryStore.of({
    save,
    savedList,
    savedSetNote,
    savedDelete,
    getSavedPost,
    collectionsList,
    collectionCreate,
    collectionRename,
    collectionDelete,
    picksForDay,
    pickFetchedKeywords,
    picksRecord,
    pickGet,
    pickSetWhy,
    pickDraftGet,
    pickSetDraft,
    suggestedDraftSave,
  });
});

export const layer = Layer.effect(LibraryStore, make);

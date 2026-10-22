import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XId } from "./baseSchemas.ts";
import { XApiError, XPost, XSearchMode, XTrend } from "./x.ts";

/** Library screen contracts: schemas, errors, method names and the RPC group. Owned by the library area. */

const CollectionId = Schema.Int;
const SavedPostId = Schema.Int;

/** A post kept by the user, with the metrics frozen at save time. */
export const SavedPost = Schema.Struct({
  id: SavedPostId,
  post: XPost,
  note: Schema.String,
  savedAt: IsoDateTime,
  collectionIds: Schema.Array(CollectionId),
});
export type SavedPost = typeof SavedPost.Type;

export const Collection = Schema.Struct({
  id: CollectionId,
  name: Schema.String,
  /** "Staff picks" is seeded and read-only; the picks of the day land in it. */
  builtIn: Schema.Boolean,
  posts: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type Collection = typeof Collection.Type;

export const Pick = Schema.Struct({
  day: Schema.String,
  keyword: Schema.String,
  post: XPost,
  whyItWorks: Schema.NullOr(Schema.String),
});
export type Pick = typeof Pick.Type;

export const TrendIdea = Schema.Struct({
  trend: Schema.String,
  angle: Schema.String,
  text: Schema.String,
});
export type TrendIdea = typeof TrendIdea.Type;

export class LibraryError extends Schema.TaggedError<LibraryError>()("LibraryError", {
  operation: Schema.Literals(["store", "assist", "settings"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Library ${this.operation} failed: ${this.detail}`;
  }
}

export const Library_METHODS = {
  search: "library.search",
  save: "library.save",
  savedList: "library.savedList",
  savedSetNote: "library.savedSetNote",
  savedDelete: "library.savedDelete",
  getSavedPost: "library.getSavedPost",
  collectionsList: "library.collectionsList",
  collectionCreate: "library.collectionCreate",
  collectionRename: "library.collectionRename",
  collectionDelete: "library.collectionDelete",
  picksGet: "library.picksGet",
  picksFetch: "library.picksFetch",
  pickWhy: "library.pickWhy",
  pickDraft: "library.pickDraft",
  suggestedDraftSave: "library.suggestedDraftSave",
  trends: "library.trends",
  trendIdeas: "library.trendIdeas",
} as const;

const SearchResult = Schema.Struct({
  items: Schema.Array(XPost),
  nextCursor: Schema.NullOr(Schema.String),
});

const PicksState = Schema.Struct({
  day: Schema.String,
  keywords: Schema.Array(Schema.String),
  /** Keywords not fetched today; the UI prices the next fetch from this. */
  pending: Schema.Array(Schema.String),
  picks: Schema.Array(Pick),
});

export const LibraryRpcGroup = RpcGroup.make(
  Rpc.make(Library_METHODS.search, {
    payload: Schema.Struct({
      query: Schema.String,
      mode: XSearchMode,
      cursor: Schema.optional(Schema.String),
    }),
    success: SearchResult,
    error: XApiError,
  }),
  Rpc.make(Library_METHODS.save, {
    payload: Schema.Struct({
      post: XPost,
      collectionId: Schema.NullOr(CollectionId),
      note: Schema.optional(Schema.String),
    }),
    success: SavedPost,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.savedList, {
    payload: Schema.Struct({
      collectionId: Schema.optional(CollectionId),
      query: Schema.optional(Schema.String),
    }),
    success: Schema.Array(SavedPost),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.savedSetNote, {
    payload: Schema.Struct({ id: SavedPostId, note: Schema.String }),
    success: Schema.Void,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.savedDelete, {
    payload: Schema.Struct({ id: SavedPostId }),
    success: Schema.Void,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.getSavedPost, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.NullOr(SavedPost),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.collectionsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(Collection),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.collectionCreate, {
    payload: Schema.Struct({ name: Schema.String }),
    success: Collection,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.collectionRename, {
    payload: Schema.Struct({ id: CollectionId, name: Schema.String }),
    success: Schema.Void,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.collectionDelete, {
    payload: Schema.Struct({ id: CollectionId }),
    success: Schema.Void,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.picksGet, {
    payload: Schema.Struct({}),
    success: PicksState,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.picksFetch, {
    payload: Schema.Struct({}),
    success: PicksState,
    error: Schema.Union([LibraryError, XApiError]),
  }),
  Rpc.make(Library_METHODS.pickWhy, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.String,
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.pickDraft, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.Array(Schema.String),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.suggestedDraftSave, {
    payload: Schema.Struct({ text: Schema.String, source: Schema.String }),
    success: Schema.Struct({ id: Schema.Int }),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.trends, {
    payload: Schema.Struct({ country: Schema.String }),
    success: Schema.Array(XTrend),
    error: XApiError,
  }),
  Rpc.make(Library_METHODS.trendIdeas, {
    payload: Schema.Struct({ country: Schema.String }),
    success: Schema.Array(TrendIdea),
    error: Schema.Union([LibraryError, XApiError]),
  }),
);

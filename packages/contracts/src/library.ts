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

/** What a post is made of; `thread` is the model's call, the other three come from the post's flags. */
export const PostFormat = Schema.Literals(["text", "media", "link", "thread"]);
export type PostFormat = typeof PostFormat.Type;

export const HookPattern = Schema.Literals([
  "contrarian claim",
  "list",
  "story",
  "question",
  "number hook",
  "how-to",
  "announcement",
  "other",
]);
export type HookPattern = typeof HookPattern.Type;

/** Author follower bands the archive filters by. */
export const AuthorBand = Schema.Literals(["under 10k", "10k to 100k", "100k to 1M", "1M+"]);
export type AuthorBand = typeof AuthorBand.Type;

/** A post the library has seen in a search or a pick, with metrics as of the last time it was seen. */
export const LibraryPost = Schema.Struct({
  post: XPost,
  format: PostFormat,
  /** Null until a detection batch has looked at it. */
  hookPattern: Schema.NullOr(HookPattern),
  lastSeenAt: IsoDateTime,
});
export type LibraryPost = typeof LibraryPost.Type;

export const LibraryFilters = Schema.Struct({
  minViews: Schema.optional(NonNegativeInt),
  format: Schema.optional(PostFormat),
  year: Schema.optional(Schema.Int),
  authorBand: Schema.optional(AuthorBand),
  lang: Schema.optional(Schema.String),
  hookPattern: Schema.optional(HookPattern),
});
export type LibraryFilters = typeof LibraryFilters.Type;

/** A curated evergreen post; `post` is null until a `from:handle` search has seen it. */
export const StaffPick = Schema.Struct({
  handle: Schema.String,
  postId: XId,
  topic: Schema.Literals(["building", "marketing", "AI"]),
  post: Schema.NullOr(XPost),
});
export type StaffPick = typeof StaffPick.Type;

export const ReadyPost = Schema.Struct({
  draftId: Schema.String,
  text: Schema.String,
  basis: Schema.String,
  /** 0 to 100, the model's own judgement of how close the draft is to the user's voice. */
  voiceMatch: Schema.Int,
});
export type ReadyPost = typeof ReadyPost.Type;

export const TrendIdea = Schema.Struct({
  trend: Schema.String,
  angle: Schema.String,
  text: Schema.String,
});
export type TrendIdea = typeof TrendIdea.Type;

/**
 * A topic ranked against the user's own interests: their posts, keywords, saved posts and the
 * accounts their session shows. `outside` is the one slot kept for a topic off their usual lane.
 */
export const ForYouTopic = Schema.Struct({
  term: Schema.String,
  source: Schema.Literals(["feed", "pool", "outside"]),
  /** Plain words, e.g. "4 accounts in your feed today · in your keywords". */
  reason: Schema.String,
  score: Schema.Number,
});
export type ForYouTopic = typeof ForYouTopic.Type;

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
  collectionRemovePost: "library.collectionRemovePost",
  picksGet: "library.picksGet",
  picksFetch: "library.picksFetch",
  pickWhy: "library.pickWhy",
  pickDraft: "library.pickDraft",
  suggestedDraftSave: "library.suggestedDraftSave",
  trends: "library.trends",
  trendIdeas: "library.trendIdeas",
  browse: "library.browse",
  detectPatterns: "library.detectPatterns",
  writeInFormat: "library.writeInFormat",
  staffPicks: "library.staffPicks",
  staffPicksFetch: "library.staffPicksFetch",
  generateReady: "library.generateReady",
  forYou: "library.forYou",
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
  /** Takes the post out of one collection; it stays in the swipe file and the others. */
  Rpc.make(Library_METHODS.collectionRemovePost, {
    payload: Schema.Struct({ collectionId: CollectionId, savedId: SavedPostId }),
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
    /** The id of a real Compose draft with status `suggested`. */
    success: Schema.Struct({ id: Schema.String }),
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
  Rpc.make(Library_METHODS.browse, {
    payload: LibraryFilters,
    success: Schema.Array(LibraryPost),
    error: LibraryError,
  }),
  /** One model call over the next 20 posts without a hook pattern; returns how many it labelled. */
  Rpc.make(Library_METHODS.detectPatterns, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ detected: NonNegativeInt, remaining: NonNegativeInt }),
    error: LibraryError,
  }),
  /** Writes a post in the user's voice with the same format and hook pattern, saved as a suggested draft. */
  Rpc.make(Library_METHODS.writeInFormat, {
    payload: Schema.Struct({ postId: XId }),
    success: Schema.Struct({ id: Schema.String, text: Schema.String }),
    error: LibraryError,
  }),
  Rpc.make(Library_METHODS.staffPicks, {
    payload: Schema.Struct({}),
    success: Schema.Array(StaffPick),
    error: LibraryError,
  }),
  /** One `from:handle` search per curated handle whose posts are still unseen. */
  Rpc.make(Library_METHODS.staffPicksFetch, {
    payload: Schema.Struct({}),
    success: Schema.Array(StaffPick),
    error: Schema.Union([LibraryError, XApiError]),
  }),
  /** Topics ranked locally against the user's interests, from their session and the pool. Free. */
  Rpc.make(Library_METHODS.forYou, {
    payload: Schema.Struct({}),
    success: Schema.Array(ForYouTopic),
    error: LibraryError,
  }),
  /** Three posts in the user's voice from today's for-you topics and picks, filed as suggested drafts. */
  Rpc.make(Library_METHODS.generateReady, {
    payload: Schema.Struct({ country: Schema.String }),
    success: Schema.Array(ReadyPost),
    error: Schema.Union([LibraryError, XApiError]),
  }),
);

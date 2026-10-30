import {
  Library_METHODS,
  LibraryFilters,
  type ReplyTone,
  type XPost,
  type XSearchMode,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

export const searchAtom = clientRuntime.fn<{
  readonly query: string;
  readonly mode: XSearchMode;
  readonly cursor?: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.search](input);
  }),
);

export const savePostAtom = clientRuntime.fn<{
  readonly post: XPost;
  readonly collectionId: number | null;
  readonly note?: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.save](input);
  }),
);

// How many pages each list shows; Show more adds one. Each resets when its list unmounts.
export const swipePagesAtom = Atom.family((_query: string) => Atom.make(1));
export const collectionPagesAtom = Atom.family((_collectionId: number) => Atom.make(1));
export const archivePagesAtom = Atom.family((_filtersKey: string) => Atom.make(1));

/**
 * The first `pages` pages of a list, one bounded request each, and the true total. Show more
 * re-reads the earlier pages too, so a refresh after an edit keeps every loaded row correct.
 */
const firstPages = Effect.fnUntraced(function* <A, E, R>(
  pages: number,
  read: (
    offset: number,
  ) => Effect.Effect<{ readonly items: ReadonlyArray<A>; readonly total: number }, E, R>,
) {
  const items: Array<A> = [];
  let total = 0;
  for (let i = 0; i < pages; i++) {
    const page = yield* read(items.length);
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0 || items.length >= total) break;
  }
  return { items, total };
});

/** The swipe file: every saved post, filtered by a text query. */
export const swipeFileAtom = Atom.family((query: string) =>
  clientRuntime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* firstPages(get(swipePagesAtom(query)), (offset) =>
        client[Library_METHODS.savedList](query === "" ? { offset } : { query, offset }),
      );
    }),
  ),
);

/**
 * Every saved post's X id, for the Saved mark: the swipe file lists a page at a time. Read
 * after the swipe file, so whatever refreshes that after a save or delete refreshes this too.
 */
export const savedIdsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(swipeFileAtom(""));
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.savedIds]({});
  }),
);

/** One saved post by X id; Compose reads the inspiration it was opened with. */
export const savedPostAtom = Atom.family((postId: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.getSavedPost]({ postId });
    }),
  ),
);

export const collectionPostsAtom = Atom.family((collectionId: number) =>
  clientRuntime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* firstPages(get(collectionPagesAtom(collectionId)), (offset) =>
        client[Library_METHODS.savedList]({ collectionId, offset }),
      );
    }),
  ),
);

export const setNoteAtom = clientRuntime.fn<{ readonly id: number; readonly note: string }>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.savedSetNote](input);
  }),
);

export const deleteSavedAtom = clientRuntime.fn<readonly [number, ...Array<number>]>()(
  Effect.fnUntraced(function* (ids) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.savedDelete]({ ids });
  }),
);

export const collectionsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionsList]({});
  }),
);

export const createCollectionAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (name) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionCreate]({ name });
  }),
);

export const renameCollectionAtom = clientRuntime.fn<{
  readonly id: number;
  readonly name: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionRename](input);
  }),
);

export const deleteCollectionAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionDelete]({ id });
  }),
);

export const removeFromCollectionAtom = clientRuntime.fn<{
  readonly collectionId: number;
  readonly savedId: number;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionRemovePost](input);
  }),
);

export const addToCollectionAtom = clientRuntime.fn<{
  readonly collectionId: number;
  readonly savedIds: readonly [number, ...Array<number>];
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.collectionAddPosts](input);
  }),
);

export const picksAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.picksGet]({});
  }),
);

export const fetchPicksAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.picksFetch]({});
  }),
);

// Model calls take seconds and rows sit side by side, so each post gets its own atom:
// a second write to a shared fn atom interrupts the first and hands both callers its result.
export const pickWhyAtom = Atom.family((postId: string) =>
  clientRuntime.fn<void>()(
    Effect.fnUntraced(function* () {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.pickWhy]({ postId });
    }),
  ),
);

export const pickDraftAtom = Atom.family((postId: string) =>
  clientRuntime.fn<ReplyTone | undefined>()(
    Effect.fnUntraced(function* (tone) {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.pickDraft]({ postId, tone });
    }),
  ),
);

export const saveSuggestedDraftAtom = clientRuntime.fn<{
  readonly blocks: readonly [string, ...Array<string>];
  readonly source: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.suggestedDraftSave](input);
  }),
);

export const trendsAtom = Atom.family((country: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.trends]({ country });
    }),
  ),
);

export const trendIdeasAtom = clientRuntime.fn<{
  readonly country: string;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.trendIdeas](input);
  }),
);

// Keyed by the JSON of the filters so equal filter sets share one query.
const FiltersJson = Schema.fromJsonString(LibraryFilters);
const decodeFilters = Schema.decodeSync(FiltersJson);
export const encodeFilters = Schema.encodeSync(FiltersJson);
export const browseAtom = Atom.family((key: string) =>
  clientRuntime.atom((get) =>
    Effect.gen(function* () {
      const client = yield* XtendClient;
      const filters = decodeFilters(key);
      return yield* firstPages(get(archivePagesAtom(key)), (offset) =>
        client[Library_METHODS.browse]({ ...filters, offset }),
      );
    }),
  ),
);

export const detectPatternsAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.detectPatterns]({});
  }),
);

/** One per post, like `pickWhyAtom`. */
export const writeInFormatAtom = Atom.family((postId: string) =>
  clientRuntime.fn<ReplyTone | undefined>()(
    Effect.fnUntraced(function* (tone) {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.writeInFormat]({ postId, tone });
    }),
  ),
);

export const staffPicksAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.staffPicks]({});
  }),
);

export const fetchStaffPicksAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.staffPicksFetch]({});
  }),
);

export const generateReadyAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (country) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.generateReady]({ country });
  }),
);

/** For-you topics, ranked by the service from the session, saved posts and the pool. Free. */
export const forYouAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.forYou]({});
  }),
);

import { Library_METHODS, type XPost, type XSearchMode } from "@xtend/contracts";
import * as Effect from "effect/Effect";
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

/** The swipe file: every saved post, filtered by a text query. */
export const swipeFileAtom = Atom.family((query: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.savedList](query === "" ? {} : { query });
    }),
  ),
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
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Library_METHODS.savedList]({ collectionId });
    }),
  ),
);

export const setNoteAtom = clientRuntime.fn<{ readonly id: number; readonly note: string }>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.savedSetNote](input);
  }),
);

export const deleteSavedAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.savedDelete]({ id });
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

export const pickWhyAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (postId) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.pickWhy]({ postId });
  }),
);

export const pickDraftAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (postId) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.pickDraft]({ postId });
  }),
);

export const saveSuggestedDraftAtom = clientRuntime.fn<{
  readonly text: string;
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

export const trendIdeasAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (country) {
    const client = yield* XtendClient;
    return yield* client[Library_METHODS.trendIdeas]({ country });
  }),
);

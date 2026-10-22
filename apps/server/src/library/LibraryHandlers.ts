import { Library_METHODS, LibraryError, LibraryRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DraftStore from "../compose/DraftStore.ts";
import * as Library from "./Library.ts";
import * as LibraryStore from "./LibraryStore.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Library.layer.pipe(Layer.provideMerge(LibraryStore.layer));

/** RPC handlers for LibraryRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = LibraryRpcGroup.toLayer(
  Effect.gen(function* () {
    const library = yield* Library.Library;
    const store = yield* LibraryStore.LibraryStore;
    const drafts = yield* DraftStore.DraftStore;
    return LibraryRpcGroup.of({
      [Library_METHODS.search]: (input) => library.search(input),
      [Library_METHODS.save]: (input) => store.save(input),
      [Library_METHODS.savedList]: (input) => store.savedList(input),
      [Library_METHODS.savedSetNote]: ({ id, note }) => store.savedSetNote(id, note),
      [Library_METHODS.savedDelete]: ({ id }) => store.savedDelete(id),
      [Library_METHODS.getSavedPost]: ({ postId }) => store.getSavedPost(postId),
      [Library_METHODS.collectionsList]: () => store.collectionsList,
      [Library_METHODS.collectionCreate]: ({ name }) => store.collectionCreate(name),
      [Library_METHODS.collectionRename]: ({ id, name }) => store.collectionRename(id, name),
      [Library_METHODS.collectionDelete]: ({ id }) => store.collectionDelete(id),
      [Library_METHODS.picksGet]: () => library.picksGet,
      [Library_METHODS.picksFetch]: () => library.picksFetch,
      [Library_METHODS.pickWhy]: ({ postId }) => library.pickWhy(postId),
      [Library_METHODS.pickDraft]: ({ postId }) => library.pickDraft(postId),
      // A suggestion is a real Compose draft, so the Ready shelf and the editor see it.
      [Library_METHODS.suggestedDraftSave]: ({ text, source }) =>
        drafts
          .create({ blocks: [{ text }], status: "suggested", source })
          .pipe(
            Effect.map((d) => ({ id: d.id })),
            Effect.mapError((e) => new LibraryError({ operation: "store", detail: e.message })),
          ),
      [Library_METHODS.trends]: ({ country }) => library.trends(country),
      [Library_METHODS.trendIdeas]: ({ country }) => library.trendIdeas(country),
    });
  }),
);

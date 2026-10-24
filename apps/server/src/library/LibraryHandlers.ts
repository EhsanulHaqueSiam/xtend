import { Library_METHODS, LibraryError, LibraryRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DraftStore from "../compose/DraftStore.ts";
import { layerDaily } from "./DailyJobs.ts";
import * as Library from "./Library.ts";
import * as LibraryStore from "./LibraryStore.ts";

/** Trends country for the ready-to-post job; the Trends tab lets the user pick others by hand. */
const READY_COUNTRY = "UnitedStates";

// DraftStore is compose's; Effect memoizes layers by reference, so this is the same store.
const layerService = Library.layer.pipe(
  Layer.provideMerge(LibraryStore.layer),
  Layer.provide(DraftStore.layer),
);

const layerJobs = layerDaily([
  { name: "library.picks", at: "08:00", run: Effect.flatMap(Library.Library, (l) => l.picksFetch) },
  {
    name: "library.detect",
    at: "08:10",
    run: Effect.flatMap(Library.Library, (l) => l.detectPatterns),
  },
  {
    name: "library.ready",
    at: "08:30",
    run: Effect.flatMap(Library.Library, (l) => l.generateReady(READY_COUNTRY)),
  },
]).pipe(Layer.provide(layerService));

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.merge(layerService, layerJobs);

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
      [Library_METHODS.collectionRemovePost]: ({ collectionId, savedId }) =>
        store.collectionRemovePost(collectionId, savedId),
      [Library_METHODS.picksGet]: () => library.picksGet,
      [Library_METHODS.picksFetch]: () => library.picksFetch,
      [Library_METHODS.pickWhy]: ({ postId }) => library.pickWhy(postId),
      [Library_METHODS.pickDraft]: ({ postId }) => library.pickDraft(postId),
      // A suggestion is a real Compose draft, so the Ready shelf and the editor see it.
      [Library_METHODS.suggestedDraftSave]: ({ text, source }) =>
        drafts.create({ blocks: [{ text }], status: "suggested", source }).pipe(
          Effect.map((d) => ({ id: d.id })),
          Effect.mapError((e) => new LibraryError({ operation: "store", detail: e.message })),
        ),
      [Library_METHODS.trends]: ({ country }) => library.trends(country),
      [Library_METHODS.trendIdeas]: ({ country }) => library.trendIdeas(country),
      [Library_METHODS.browse]: (filters) => store.browse(filters),
      [Library_METHODS.detectPatterns]: () => library.detectPatterns,
      [Library_METHODS.writeInFormat]: ({ postId }) => library.writeInFormat(postId),
      [Library_METHODS.staffPicks]: () => library.staffPicks,
      [Library_METHODS.staffPicksFetch]: () => library.staffPicksFetch,
      [Library_METHODS.generateReady]: ({ country }) => library.generateReady(country),
    });
  }),
);

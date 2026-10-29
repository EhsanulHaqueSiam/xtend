import { Library_METHODS, LibraryError, LibraryRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DraftStore from "../compose/DraftStore.ts";
import * as Pool from "../pool/Pool.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import { layerDaily } from "./DailyJobs.ts";
import * as Library from "./Library.ts";
import * as LibraryStore from "./LibraryStore.ts";

/** Cold-start trends country for the ready-to-post job, used until for-you topics exist. */
const READY_COUNTRY = "UnitedStates";

// DraftStore is compose's and Pool the pool area's; Effect memoizes layers by reference, so
// these are the same instances.
const layerService = Library.layer.pipe(
  Layer.provideMerge(LibraryStore.layer),
  Layer.provide(Layer.mergeAll(DraftStore.layer, Pool.layer)),
);

// Each job spends (searches, model calls) with nobody clicking, so all of them wait for the
// opt-in in Settings; the screens' own buttons do the same work on demand with their price shown.
const optedIn = Effect.flatMap(SettingsStore.SettingsStore, (s) =>
  Effect.map(s.get, (v) => v.dailyLibraryJobs),
).pipe(Effect.orElseSucceed(() => false));

const layerJobs = layerDaily([
  {
    name: "library.picks",
    at: "08:00",
    enabled: optedIn,
    run: Effect.flatMap(Library.Library, (l) => l.picksFetch),
  },
  {
    name: "library.detect",
    at: "08:10",
    enabled: optedIn,
    run: Effect.flatMap(Library.Library, (l) => l.detectPatterns),
  },
  {
    name: "library.ready",
    at: "08:30",
    enabled: optedIn,
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
      [Library_METHODS.pickDraft]: ({ postId, tone }) => library.pickDraft(postId, tone),
      // A suggestion is a real Compose draft, so the Ready shelf and the editor see it.
      [Library_METHODS.suggestedDraftSave]: ({ blocks, source }) =>
        drafts
          .create({ blocks: blocks.map((text) => ({ text })), status: "suggested", source })
          .pipe(
            Effect.map((d) => ({ id: d.id })),
            Effect.mapError((e) => new LibraryError({ operation: "store", detail: e.message })),
          ),
      [Library_METHODS.trends]: ({ country }) => library.trends(country),
      [Library_METHODS.trendIdeas]: ({ country, tone }) => library.trendIdeas(country, tone),
      [Library_METHODS.browse]: (filters) => store.browse(filters),
      [Library_METHODS.detectPatterns]: () => library.detectPatterns,
      [Library_METHODS.writeInFormat]: ({ postId, tone }) => library.writeInFormat(postId, tone),
      [Library_METHODS.staffPicks]: () => library.staffPicks,
      [Library_METHODS.staffPicksFetch]: () => library.staffPicksFetch,
      [Library_METHODS.forYou]: () => library.forYou,
      [Library_METHODS.generateReady]: ({ country }) => library.generateReady(country),
    });
  }),
);

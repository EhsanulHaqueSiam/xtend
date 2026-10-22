import { Compose_METHODS, ComposeRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BestTime from "./BestTime.ts";
import * as ComposeAssist from "./ComposeAssist.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as Scheduler from "./Scheduler.ts";
import * as SlotStore from "./SlotStore.ts";

/** Services for Compose and Plan. Plan's handlers read these from the application environment. */
export const layer = Layer.mergeAll(
  ComposeAssist.layer,
  BestTime.layer,
  SlotStore.layer,
  Scheduler.layer,
).pipe(Layer.provideMerge(Publisher.layer), Layer.provideMerge(DraftStore.layer));

/** RPC handlers for ComposeRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = ComposeRpcGroup.toLayer(
  Effect.gen(function* () {
    const drafts = yield* DraftStore.DraftStore;
    const publisher = yield* Publisher.Publisher;
    const assist = yield* ComposeAssist.ComposeAssist;
    return ComposeRpcGroup.of({
      [Compose_METHODS.draftsList]: () => Effect.map(drafts.list, (list) => ({ drafts: list })),
      [Compose_METHODS.draftCreate]: (patch) => drafts.create(patch),
      [Compose_METHODS.draftUpdate]: ({ id, patch }) => drafts.update(id, patch),
      [Compose_METHODS.draftDelete]: ({ id }) => drafts.remove(id),
      [Compose_METHODS.postNow]: ({ id }) =>
        publisher.post(id, { purpose: "compose.postNow", retry: false }),
      [Compose_METHODS.assistHook]: ({ blocks }) => assist.improveHook(blocks),
      [Compose_METHODS.assistRewrite]: ({ text }) => assist.rewrite(text),
      [Compose_METHODS.assistThreadIdeas]: ({ topic }) => assist.threadIdeas(topic),
      [Compose_METHODS.assistContinue]: ({ blocks }) => assist.continueThread(blocks),
      [Compose_METHODS.assistVoiceMatch]: ({ blocks }) => assist.voiceMatch(blocks),
    });
  }),
);

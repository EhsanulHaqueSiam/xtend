import { Engage_METHODS, EngageRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Engage from "./Engage.ts";
import * as EngageStore from "./EngageStore.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Engage.layer.pipe(Layer.provideMerge(EngageStore.layer));

/** RPC handlers for EngageRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = EngageRpcGroup.toLayer(
  Effect.gen(function* () {
    const engage = yield* Engage.Engage;
    const store = yield* EngageStore.EngageStore;
    return EngageRpcGroup.of({
      [Engage_METHODS.targets]: () => engage.targets,
      [Engage_METHODS.draftReply]: ({ post }) => engage.draftReply(post),
      [Engage_METHODS.reply]: ({ post, text }) => engage.reply(post, text),
      [Engage_METHODS.like]: ({ postId }) => engage.like(postId),
      [Engage_METHODS.findKeywords]: () => engage.findKeywords,
      [Engage_METHODS.mentions]: ({ refresh }) => engage.mentions(refresh === true),
      [Engage_METHODS.mentionHandled]: ({ postId }) => store.markHandled(postId),
      [Engage_METHODS.inbox]: () =>
        Effect.all({ sent: store.sentList, followUps: store.followUps }),
    });
  }),
);

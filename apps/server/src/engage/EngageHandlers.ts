import { Engage_METHODS, EngageRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerDaily } from "../library/DailyJobs.ts";
import * as SessionPosting from "../compose/SessionPosting.ts";
import * as DesktopChannel from "../desktop/DesktopChannel.ts";
import * as Treg from "../x/Treg.ts";
import * as Engage from "./Engage.ts";
import * as EngageStore from "./EngageStore.ts";

// Treg and DesktopChannel by reference, as in ComposeHandlers: Effect memoizes one build each.
const layerService = Engage.layer.pipe(
  Layer.provideMerge(EngageStore.layer),
  Layer.provide(SessionPosting.layer),
  Layer.provide(Layer.mergeAll(Treg.layer, DesktopChannel.layer)),
);

const layerJobs = layerDaily([
  { name: "engage.niche", at: "03:00", run: Effect.flatMap(Engage.Engage, (e) => e.nicheRebuild) },
]).pipe(Layer.provide(layerService));

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.merge(layerService, layerJobs);

/** RPC handlers for EngageRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = EngageRpcGroup.toLayer(
  Effect.gen(function* () {
    const engage = yield* Engage.Engage;
    const store = yield* EngageStore.EngageStore;
    return EngageRpcGroup.of({
      [Engage_METHODS.targets]: () => engage.targets,
      [Engage_METHODS.draftReply]: ({ post, tone, own }) => engage.draftReply(post, tone, own),
      [Engage_METHODS.reply]: ({ post, text }) => engage.reply(post, text),
      [Engage_METHODS.like]: ({ postId }) => engage.like(postId),
      [Engage_METHODS.findKeywords]: () => engage.findKeywords,
      [Engage_METHODS.mentions]: ({ refresh }) => engage.mentions(refresh === true),
      [Engage_METHODS.mentionHandled]: ({ postIds, handled }) => store.setHandled(postIds, handled),
      [Engage_METHODS.inbox]: () => engage.inbox,
      [Engage_METHODS.followUpClose]: ({ id, state }) => store.closeFollowUp(id, state),
      [Engage_METHODS.nicheProfile]: () => store.nicheGet,
      [Engage_METHODS.nicheRebuild]: () => engage.nicheRebuild,
      [Engage_METHODS.dms]: ({ load }) => engage.dms(load),
    });
  }),
);

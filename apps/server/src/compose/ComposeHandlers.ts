import { Compose_METHODS, ComposeRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopChannel from "../desktop/DesktopChannel.ts";
import * as Treg from "../x/Treg.ts";
import * as Articles from "./Articles.ts";
import * as BestTime from "./BestTime.ts";
import * as ComposeAssist from "./ComposeAssist.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Media from "./Media.ts";
import * as Publisher from "./Publisher.ts";
import * as Scheduler from "./Scheduler.ts";
import * as SessionPosting from "./SessionPosting.ts";
import * as SlotStore from "./SlotStore.ts";

/**
 * Services for Compose and Plan. Plan's handlers read these from the application environment.
 * Treg and DesktopChannel are provided by reference: Effect memoizes a layer per build, so
 * these are the same instances XClient and the desktop area use.
 */
export const layer = Layer.mergeAll(ComposeAssist.layer, BestTime.layer, Scheduler.layer).pipe(
  Layer.provideMerge(Publisher.layer),
  Layer.provideMerge(Layer.mergeAll(Articles.layer, SessionPosting.layer, SlotStore.layer)),
  Layer.provideMerge(Media.layer),
  Layer.provideMerge(DraftStore.layer),
  Layer.provide(Layer.mergeAll(Treg.layer, DesktopChannel.layer)),
);

/** RPC handlers for ComposeRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = ComposeRpcGroup.toLayer(
  Effect.gen(function* () {
    const drafts = yield* DraftStore.DraftStore;
    const publisher = yield* Publisher.Publisher;
    const assist = yield* ComposeAssist.ComposeAssist;
    const media = yield* Media.Media;
    const articles = yield* Articles.Articles;
    const bestTime = yield* BestTime.BestTime;
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
      [Compose_METHODS.mediaAdd]: ({ draftId, blockIndex, kind, name, base64, alt }) =>
        media.add({
          draftId,
          blockIndex,
          kind,
          ext: name.split(".").pop() ?? "bin",
          bytes: Uint8Array.from(Buffer.from(base64, "base64")),
          ...(alt === undefined ? {} : { alt }),
        }),
      [Compose_METHODS.mediaRemove]: ({ draftId, id }) => media.remove(draftId, id),
      [Compose_METHODS.generateCover]: ({ draftId, prompt }) =>
        Effect.flatMap(drafts.get(draftId), (d) =>
          articles.generateCover(d, prompt, "compose.generateCover"),
        ),
      [Compose_METHODS.quote]: () => Effect.succeed(articles.quote),
      [Compose_METHODS.context]: () => bestTime.context,
    });
  }),
);

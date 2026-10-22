import { Compose_METHODS, type DraftPatch } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const draftsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return (yield* client[Compose_METHODS.draftsList]({})).drafts;
  }),
);

export const createDraftAtom = clientRuntime.fn<DraftPatch>()(
  Effect.fnUntraced(function* (patch) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.draftCreate](patch);
  }),
);

export const updateDraftAtom = clientRuntime.fn<{
  readonly id: string;
  readonly patch: DraftPatch;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.draftUpdate](input);
  }),
);

export const deleteDraftAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.draftDelete]({ id });
  }),
);

export const postNowAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.postNow]({ id });
  }),
);

export const assistHookAtom = clientRuntime.fn<ReadonlyArray<string>>()(
  Effect.fnUntraced(function* (blocks) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistHook]({ blocks });
  }),
);

export const assistRewriteAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (text) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistRewrite]({ text });
  }),
);

export const assistThreadIdeasAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (topic) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistThreadIdeas]({ topic });
  }),
);

export const assistContinueAtom = clientRuntime.fn<ReadonlyArray<string>>()(
  Effect.fnUntraced(function* (blocks) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistContinue]({ blocks });
  }),
);

export const assistVoiceMatchAtom = clientRuntime.fn<ReadonlyArray<string>>()(
  Effect.fnUntraced(function* (blocks) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistVoiceMatch]({ blocks });
  }),
);

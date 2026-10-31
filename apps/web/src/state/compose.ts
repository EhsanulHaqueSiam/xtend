import { Compose_METHODS, type DraftPatch, type MediaKind, type ReplyTone } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/** Refetched on every status event: the scheduler posts and fails drafts while the list is open. */
export const draftsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("draft_status_changed"));
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

/** Post now through the user's session only, for a Post button that showed no price. */
export const sessionPostNowAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.postNow]({ id, sessionOnly: true });
  }),
);

export const assistHookAtom = clientRuntime.fn<{
  readonly blocks: ReadonlyArray<string>;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistHook](input);
  }),
);

export const assistRewriteAtom = clientRuntime.fn<{
  readonly text: string;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistRewrite](input);
  }),
);

export const assistThreadIdeasAtom = clientRuntime.fn<{
  readonly topic: string;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistThreadIdeas](input);
  }),
);

export const assistContinueAtom = clientRuntime.fn<{
  readonly blocks: ReadonlyArray<string>;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistContinue](input);
  }),
);

export const assistVoiceMatchAtom = clientRuntime.fn<ReadonlyArray<string>>()(
  Effect.fnUntraced(function* (blocks) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.assistVoiceMatch]({ blocks });
  }),
);

export const mediaAddAtom = clientRuntime.fn<{
  readonly draftId: string;
  readonly blockIndex: number;
  readonly kind: MediaKind;
  readonly name: string;
  readonly base64: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.mediaAdd](input);
  }),
);

export const mediaRemoveAtom = clientRuntime.fn<{
  readonly draftId: string;
  readonly id: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.mediaRemove](input);
  }),
);

/** Paid: one cover image from the model in `composeQuoteAtom`. */
export const generateCoverAtom = clientRuntime.fn<{
  readonly draftId: string;
  readonly prompt: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.generateCover](input);
  }),
);

/** Article and cover prices; the only place the editor learns them. */
export const composeQuoteAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.quote]({});
  }),
);

/** Next free slot, best hours and whether a desktop can post media; refreshed when the editor opens. */
export const composeContextAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Compose_METHODS.context]({});
  }),
);

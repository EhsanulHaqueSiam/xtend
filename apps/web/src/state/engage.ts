import { Engage_METHODS, WS_METHODS, type XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const targetsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.targets]({});
  }),
);

export const draftReplyAtom = clientRuntime.fn<XPost>()(
  Effect.fnUntraced(function* (post) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.draftReply]({ post });
  }),
);

export const sendReplyAtom = clientRuntime.fn<{ readonly post: XPost; readonly text: string }>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.reply](input);
  }),
);

export const likeAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (postId) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.like]({ postId });
  }),
);

export const findKeywordsAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.findKeywords]({});
  }),
);

/** "Add to keywords" writes through the core settings rpc so Settings stays the one owner. */
export const addKeywordsAtom = clientRuntime.fn<ReadonlyArray<string>>()(
  Effect.fnUntraced(function* (keywords) {
    const client = yield* XtendClient;
    const current = yield* client[WS_METHODS.settingsGet]({});
    const merged = [...new Set([...current.keywords, ...keywords])];
    return yield* client[WS_METHODS.settingsUpdate]({ keywords: merged });
  }),
);

/** Free: session mentions plus what earlier refreshes fetched. */
export const mentionsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.mentions]({});
  }),
);

/** Paid: one page of mentions newer than the last stored one. Refresh mentionsAtom after it. */
export const refreshMentionsAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.mentions]({ refresh: true });
  }),
);

export const markHandledAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (postId) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.mentionHandled]({ postId });
  }),
);

export const inboxAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.inbox]({});
  }),
);

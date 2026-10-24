import { Engage_METHODS, WS_METHODS, type XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";
import { eventsOfTypeAtom } from "./shell";

/**
 * Paid: one search per keyword, cached 30 min by the service. Runs on the priced click, or on
 * open when the quote says the cache serves it free; never just because the tab mounted. Kept
 * alive: the click does not await it, so leaving Engage mid-search would interrupt paid reads.
 */
export const targetsAtom = Atom.keepAlive(
  clientRuntime.fn<void>()(
    Effect.fnUntraced(function* () {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.targets]({});
    }),
  ),
);

// Per target post: a new write to a shared fn atom interrupts the call still running, so a
// like on one row would cut off a paid like or reply in flight on another.
export const draftReplyAtom = Atom.family((_postId: string) =>
  clientRuntime.fn<XPost>()(
    Effect.fnUntraced(function* (post) {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.draftReply]({ post });
    }),
  ),
);

export const sendReplyAtom = Atom.family((_postId: string) =>
  clientRuntime.fn<{ readonly post: XPost; readonly text: string }>()(
    Effect.fnUntraced(function* (input) {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.reply](input);
    }),
  ),
);

export const likeAtom = Atom.family((postId: string) =>
  clientRuntime.fn<void>()(
    Effect.fnUntraced(function* () {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.like]({ postId });
    }),
  ),
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

/** Free: session mentions plus what earlier refreshes fetched. Follows new mentions, so the Today card's count does. */
export const mentionsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("mention_arrived"));
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

export const nicheAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.nicheProfile]({});
  }),
);

export const rebuildNicheAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.nicheRebuild]({});
  }),
);

/** `load: false` only returns X's quote for one DM page; `load: true` pays for it. */
export const dmsAtom = clientRuntime.fn<boolean>()(
  Effect.fnUntraced(function* (load) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.dms]({ load });
  }),
);

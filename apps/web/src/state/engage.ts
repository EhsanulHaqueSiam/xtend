import { Engage_METHODS, WS_METHODS, type ReplyTone, type XPost } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
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
  clientRuntime.fn<{
    readonly post: XPost;
    readonly tone: ReplyTone | null;
    readonly own?: string;
  }>()(
    Effect.fnUntraced(function* ({ post, tone, own }) {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.draftReply]({
        post,
        ...(tone === null ? {} : { tone }),
        ...(own === undefined ? {} : { own }),
      });
    }),
  ),
);

/** Free on the user's login: what the post is, and replies written for it. Per post, like the drafts. */
export const readPostAtom = Atom.family((_postId: string) =>
  clientRuntime.fn<{
    readonly post: XPost;
    readonly images: ReadonlyArray<string>;
    readonly thread: ReadonlyArray<string>;
    readonly correction?: string | undefined;
  }>()(
    Effect.fnUntraced(function* ({ correction, ...input }) {
      const client = yield* XtendClient;
      return yield* client[Engage_METHODS.readPost]({
        ...input,
        ...(correction === undefined ? {} : { correction }),
      });
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

/**
 * The newest observation batch that carried posts, once a burst of them settles: the session may
 * have seen a mention or a reply. Debounced, so scrolling X refetches the free reads once.
 */
const observedAtom = Atom.debounce(
  Atom.make((get) =>
    get(eventsOfTypeAtom("observation_recorded")).findLast((e) => e.payload["posts"] !== 0),
  ),
  "1 second",
);

/** Free: session mentions plus what earlier refreshes fetched. Follows new mentions, so the Today card's count does. */
export const mentionsAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(eventsOfTypeAtom("mention_arrived"));
    get(observedAtom);
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

/** `handled: false` reopens them. */
export const markHandledAtom = clientRuntime.fn<{
  readonly postIds: ReadonlyArray<string>;
  readonly handled: boolean;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.mentionHandled](input);
  }),
);

/** Free: replies to the user the session saw, and what was sent. Follows the session. */
export const inboxAtom = clientRuntime.atom((get) =>
  Effect.gen(function* () {
    get(observedAtom);
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.inbox]({});
  }),
);

/**
 * Everything said to the user, once each, newest first: mentions plus replies and quotes to
 * their posts. A reply usually names the user too, so it is in both reads; it shows once, as a
 * reply. `replies` holds those ids; `apiError` is the last paid mention fetch's refusal.
 */
export const inboxItemsAtom = Atom.make((get) =>
  AsyncResult.map(AsyncResult.all([get(mentionsAtom), get(inboxAtom)]), ([seen, inbox]) => {
    const replies = new Set(inbox.incoming.map((m) => m.post.postId));
    return {
      items: [
        ...inbox.incoming,
        ...seen.mentions.filter((m) => !replies.has(m.post.postId)),
      ].toSorted((a, b) => b.post.createdAt.localeCompare(a.post.createdAt)),
      replies,
      apiError: seen.apiError,
    };
  }),
);

/** Done or dismissed takes a follow-up off the due list; `state: null` puts it back. */
export const closeFollowUpAtom = clientRuntime.fn<{
  readonly id: number;
  readonly state: "done" | "dismissed" | null;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Engage_METHODS.followUpClose](input);
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

import { ObservationListRecentInput, WS_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Schema from "effect/Schema";

import { clientRuntime, XtendClient } from "../rpc/client";

// Keyed by the query's JSON so equal pages share one fetch.
const InputJson = Schema.fromJsonString(ObservationListRecentInput);
const decodeInput = Schema.decodeSync(InputJson);
const encodeInput = Schema.encodeSync(InputJson);
const seenPageFamily = Atom.family((key: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[WS_METHODS.observationsListRecent](decodeInput(key));
    }),
  ),
);
/** One page of Seen, narrowed by text and author; an older page starts at a cursor. */
export const seenPageAtom = (input: ObservationListRecentInput) =>
  seenPageFamily(encodeInput(input));

export const recentPostsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.observationsListRecent]({ limit: 100 });
  }),
);

/** What the session saw one handle post, newest first: free to read, never a call to X. */
export const seenByAtom = Atom.family((handle: string) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[WS_METHODS.observationsListRecent]({ authorHandle: handle, limit: 20 });
    }),
  ),
);

export const serverInfoAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.serverInfo]({});
  }),
);

/** One observed post by id, looked up fresh: a drop should find what the session just scrolled past. */
export const observedPostAtom = clientRuntime.fn<{
  readonly handle: string;
  readonly postId: string;
}>()(
  Effect.fnUntraced(function* ({ handle, postId }) {
    const client = yield* XtendClient;
    const { posts } = yield* client[WS_METHODS.observationsListRecent]({
      authorHandle: handle,
      limit: 200,
    });
    return posts.find((p) => p.postId === postId);
  }),
);

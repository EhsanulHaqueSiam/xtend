import { WS_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

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

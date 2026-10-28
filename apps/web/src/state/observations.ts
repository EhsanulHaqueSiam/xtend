import { WS_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const recentPostsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.observationsListRecent]({ limit: 100 });
  }),
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

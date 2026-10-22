import { WS_METHODS, type ThreadEventRecord, type ThreadId } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { clientRuntime, XtendClient } from "../rpc/client";

export const threadsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.threadsList]({});
  }),
);

/** Full transcript of one thread, growing as the service appends. */
export const threadEventsAtom = Atom.family((threadId: ThreadId) =>
  clientRuntime.atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const client = yield* XtendClient;
        return client[WS_METHODS.threadsSubscribe]({ threadId }).pipe(
          Stream.scan(
            () => [] as ReadonlyArray<ThreadEventRecord>,
            (events, record) => [...events, record],
          ),
        );
      }),
    ),
    { initialValue: [] as ReadonlyArray<ThreadEventRecord> },
  ),
);

export const createThreadAtom = clientRuntime.fn<string | undefined>()(
  Effect.fnUntraced(function* (title: string | undefined) {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.threadsCreate](title === undefined ? {} : { title });
  }),
);

export const sendMessageAtom = clientRuntime.fn<{
  readonly threadId: ThreadId;
  readonly text: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[WS_METHODS.threadsSend](input);
  }),
);

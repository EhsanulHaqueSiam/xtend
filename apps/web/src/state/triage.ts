import { Triage_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

/** Where the service keeps its logs, trace and triage folders, on its own machine. */
export const triagePathsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Triage_METHODS.paths]({});
  }),
);

/** The scrubbed context `xtend triage` writes, as text to copy. */
export const triageContextAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return (yield* client[Triage_METHODS.context]({})).text;
  }),
);

/** Writes a triage folder, as `xtend triage` does, and returns the lines that start an agent. */
export const prepareTriageAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Triage_METHODS.prepare]({});
  }),
);

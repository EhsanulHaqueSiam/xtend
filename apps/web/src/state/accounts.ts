import { Accounts_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";

export const accountsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Accounts_METHODS.list]({});
  }),
);

export const createAccountAtom = clientRuntime.fn<{
  readonly handle: string | null;
  readonly label: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Accounts_METHODS.create](input);
  }),
);

export const selectAccountAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Accounts_METHODS.select]({ id });
  }),
);

/**
 * Every screen caches rows of the old account, so a switch reloads the page.
 * The desktop rebuilds its window instead, which also opens the account's own
 * x.com session partition.
 */
export const switchAccount = (id: number) => {
  const bridge = window.desktopBridge;
  if (bridge !== undefined) bridge.selectAccount(id);
  else window.location.reload();
};

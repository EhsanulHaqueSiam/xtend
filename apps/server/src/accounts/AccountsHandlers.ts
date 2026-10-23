import { Accounts_METHODS, AccountsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import * as AccountStore from "./AccountStore.ts";

export const layer = AccountStore.layer;

export const layerHandlers = AccountsRpcGroup.toLayer(
  Effect.gen(function* () {
    const accounts = yield* AccountStore.AccountStore;
    return AccountsRpcGroup.of({
      [Accounts_METHODS.list]: () => accounts.list,
      [Accounts_METHODS.create]: (input) => accounts.create(input),
      [Accounts_METHODS.select]: ({ id }) => accounts.select(id),
    });
  }),
);

import { type Account, type AccountList, AccountsError } from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Events from "../events/Events.ts";

interface AccountRow {
  readonly id: number;
  readonly handle: string | null;
  readonly label: string;
  readonly created_at: string;
}

export class AccountStore extends Context.Service<
  AccountStore,
  {
    readonly list: Effect.Effect<AccountList, AccountsError>;
    readonly create: (input: {
      readonly handle: string | null;
      readonly label: string;
    }) => Effect.Effect<AccountList, AccountsError>;
    /**
     * Makes `id` current and points settings.handle at it, so handle-scoped screens follow, and
     * tells every client. Refused while a draft of the current account is posting: its remaining
     * media posts would go out through the new account's x.com session.
     */
    readonly select: (id: number) => Effect.Effect<AccountList, AccountsError>;
  }
>()("xtend/accounts/AccountStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const events = yield* Events.Events;

  const toAccount = (r: AccountRow): Account => ({
    id: r.id,
    handle: r.handle,
    label: r.label,
    createdAt: r.created_at,
  });

  const list = Effect.gen(function* () {
    const rows = yield* sql<AccountRow>`SELECT * FROM accounts ORDER BY id`;
    const current = yield* sql<{ current_account_id: number }>`
      SELECT current_account_id FROM settings WHERE id = 1
    `;
    return { accounts: rows.map(toAccount), currentId: current[0]?.current_account_id ?? 1 };
  }).pipe(
    Effect.mapError((cause) => new AccountsError({ operation: "list", detail: String(cause) })),
  );

  const create = Effect.fn("AccountStore.create")(
    function* (input: { readonly handle: string | null; readonly label: string }) {
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO accounts (handle, label, created_at)
        VALUES (${input.handle === null ? null : input.handle.toLowerCase()}, ${input.label}, ${at})
      `;
      return yield* list;
    },
    Effect.mapError((cause) => new AccountsError({ operation: "create", detail: String(cause) })),
  );

  const select = Effect.fn("AccountStore.select")(
    function* (id: number) {
      const rows = yield* sql<AccountRow>`SELECT * FROM accounts WHERE id = ${id}`;
      const account = rows[0];
      if (account === undefined) return yield* Effect.fail(`no account ${id}`);
      // One statement, so a publisher cannot claim a draft between the check and the switch.
      const switched = yield* sql<{ id: number }>`
        UPDATE settings SET current_account_id = ${id}, handle = ${account.handle}
        WHERE id = 1 AND current_account_id <> ${id} AND NOT EXISTS (
          SELECT 1 FROM drafts WHERE status = 'posting' AND account_id = settings.current_account_id
        )
        RETURNING id
      `;
      const accounts = yield* list;
      if (switched.length > 0)
        yield* events.publish({ type: "account_switched", payload: { accountId: id } });
      else if (accounts.currentId !== id)
        return yield* Effect.fail(
          "a post is still going out on this account; switch when it is done",
        );
      return accounts;
    },
    Effect.mapError((cause) => new AccountsError({ operation: "select", detail: String(cause) })),
  );

  return AccountStore.of({ list, create, select });
});

// Events is memoized by reference, so every layer that provides it shares one hub.
export const layer = Layer.effect(AccountStore, make).pipe(Layer.provide(Events.layer));

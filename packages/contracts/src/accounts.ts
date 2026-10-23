import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, XHandle } from "./baseSchemas.ts";

/**
 * Accounts: one row per X handle the user runs. Every per-account table carries
 * an account_id and the stores read only the current one, so switching accounts
 * swaps the whole suite. Ghostwriting is several accounts.
 */
export const Account = Schema.Struct({
  id: Schema.Int,
  handle: Schema.NullOr(XHandle),
  label: Schema.String,
  createdAt: IsoDateTime,
});
export type Account = typeof Account.Type;

export const AccountList = Schema.Struct({
  accounts: Schema.Array(Account),
  currentId: Schema.Int,
});
export type AccountList = typeof AccountList.Type;

export class AccountsError extends Schema.TaggedError<AccountsError>()("AccountsError", {
  operation: Schema.Literals(["list", "create", "select"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Accounts ${this.operation} failed: ${this.detail}`;
  }
}

export const Accounts_METHODS = {
  list: "accounts.list",
  create: "accounts.create",
  select: "accounts.select",
} as const;

export const AccountsRpcGroup = RpcGroup.make(
  Rpc.make(Accounts_METHODS.list, {
    payload: Schema.Struct({}),
    success: AccountList,
    error: AccountsError,
  }),
  Rpc.make(Accounts_METHODS.create, {
    payload: Schema.Struct({
      handle: Schema.NullOr(XHandle),
      label: Schema.String.check(Schema.isMinLength(1)),
    }),
    success: AccountList,
    error: AccountsError,
  }),
  Rpc.make(Accounts_METHODS.select, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: AccountList,
    error: AccountsError,
  }),
);

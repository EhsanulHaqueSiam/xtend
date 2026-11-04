import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

/**
 * X's settings change log: which of X's setting values Xtend saw change, and when, per account.
 * It holds only what X's settings pages drew for a toggle, a choice or a pick (never a field the
 * user types), so a setting flipped on the phone shows the next time its page is opened here.
 */

const Bounded = Schema.String.check(Schema.isMaxLength(300));

/** One value as X's page drew it: `key` is X's page and the control's label there. */
export const XSettingValue = Schema.Struct({
  key: Bounded,
  /** X's page the value is on, and the control's label, for the log's line. */
  page: Bounded,
  label: Bounded,
  /** "On" or "Off" for a checkbox or switch; the picked choice's label for a radio or select. */
  value: Bounded,
});
export type XSettingValue = typeof XSettingValue.Type;

export const XSettingChange = Schema.Struct({
  key: Schema.String,
  page: Schema.String,
  label: Schema.String,
  from: Schema.String,
  to: Schema.String,
  at: Schema.String,
  /** Changed by a click in Xtend; false when X's page showed it changed elsewhere. */
  inXtend: Schema.Boolean,
});
export type XSettingChange = typeof XSettingChange.Type;

export class XSettingsError extends Schema.TaggedError<XSettingsError>()("XSettingsError", {
  operation: Schema.Literals(["seen", "changes"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `X settings failed during ${this.operation}.`;
  }
}

export const XSettings_METHODS = {
  seen: "xSettings.seen",
  changes: "xSettings.changes",
} as const;

export const XSettingsRpcGroup = RpcGroup.make(
  /**
   * The values X's page drew, as Xtend read them. `pressed` holds the keys the user changed in
   * Xtend that X's page now shows, so those changes are logged as theirs. Answers with the changes
   * logged now.
   */
  Rpc.make(XSettings_METHODS.seen, {
    payload: Schema.Struct({
      /**
       * The Xtend account whose session view drew the values: a request handled after a switch
       * still belongs to it, not the current one.
       */
      accountId: Schema.Int,
      values: Schema.Array(XSettingValue).check(Schema.isMaxLength(200)),
      pressed: Schema.Array(Bounded).check(Schema.isMaxLength(200)),
    }),
    success: Schema.Array(XSettingChange),
    error: XSettingsError,
  }),
  /** The account's logged changes, newest first. */
  Rpc.make(XSettings_METHODS.changes, {
    payload: Schema.Struct({}),
    success: Schema.Array(XSettingChange),
    error: XSettingsError,
  }),
);

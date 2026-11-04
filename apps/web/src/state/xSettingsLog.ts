import { type XSettingValue, XSettings_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";

import { clientRuntime, XtendClient } from "../rpc/client";
import type { XSettingsRead } from "./xSettings";

/** The account's X settings changes as Xtend saw them, newest first. */
export const xSettingsChangesAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[XSettings_METHODS.changes]({});
  }),
);

/** Files what X's page drew; `pressed` is the key the user just clicked in Xtend. */
export const xSettingsSeenAtom = clientRuntime.fn<{
  readonly values: ReadonlyArray<XSettingValue>;
  readonly pressed: string | null;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[XSettings_METHODS.seen](input);
  }),
);

const MAX = 300;

/** A control's key in the log: X's page and the label X draws it under there. */
export const settingKey = (path: string, label: string) => `${path} ${label}`.slice(0, MAX);

/**
 * The values a read of X's page holds, as the log files them: checkboxes and switches as On or
 * Off, a radio group or select as the label of its pick. Never a field the user types into.
 */
export const loggedValues = (read: XSettingsRead): ReadonlyArray<XSettingValue> => {
  const page = read.title.slice(0, MAX);
  return read.items.flatMap((item) => {
    const value =
      item.kind === "check"
        ? { label: item.label, value: item.checked ? "On" : "Off" }
        : item.kind === "radio" && item.checked
          ? { label: item.group, value: item.label }
          : item.kind === "select"
            ? {
                label: item.label,
                value: item.options.find((o) => o.value === item.value)?.label ?? item.value,
              }
            : null;
    return value === null || value.label === ""
      ? []
      : [
          {
            key: settingKey(read.path, value.label),
            page,
            label: value.label.slice(0, MAX),
            value: value.value.slice(0, MAX),
          },
        ];
  });
};

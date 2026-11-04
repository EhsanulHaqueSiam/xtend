import { type XSettingValue, XSettings_METHODS } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";
import type { XSettingsItem, XSettingsRead } from "./xSettings";

/** The account's X settings changes as Xtend saw them, newest first. */
export const xSettingsChangesAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[XSettings_METHODS.changes]({});
  }),
);

/** Files what X's page drew; `pressed` are the keys whose change is the user's, from Xtend. */
export const xSettingsSeenAtom = clientRuntime.fn<{
  readonly accountId: number;
  readonly values: ReadonlyArray<XSettingValue>;
  readonly pressed: ReadonlyArray<string>;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[XSettings_METHODS.seen](input);
  }),
);

const MAX = 300;

/** A control's key in the log: X's page and the label X draws it under there. */
export const settingKey = (path: string, label: string) => `${path} ${label}`.slice(0, MAX);

/** What the log files for a control: On or Off, a radio's pick, a select's picked label. */
export const valueOf = (item: XSettingsItem) =>
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

/**
 * The values a read of X's page holds, as the log files them: checkboxes and switches as On or
 * Off, a radio group or select as the label of its pick. Never a field the user types into.
 */
export const loggedValues = (read: XSettingsRead): ReadonlyArray<XSettingValue> => {
  const page = read.title.slice(0, MAX);
  return read.items.flatMap((item) => {
    const value = valueOf(item);
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

/**
 * What a press asks X to set: the control's key in the log and the value it would show, for a
 * checkbox the other one, for a radio itself, for a select the label of `picked`. Null for none.
 */
export const pressTarget = (path: string, item: XSettingsItem, picked?: string) => {
  const after: XSettingsItem | null =
    item.kind === "check"
      ? { ...item, checked: !item.checked }
      : item.kind === "radio"
        ? { ...item, checked: true }
        : item.kind === "select" && picked !== undefined
          ? { ...item, value: picked }
          : null;
  const value = after === null ? null : valueOf(after);
  return value === null
    ? null
    : { key: settingKey(path, value.label), value: value.value.slice(0, MAX) };
};

/**
 * The user's changes X took but the log has not seen yet, by account and key, with the value X
 * will show: kept apart from any screen, so leaving before X draws it keeps it the user's. Each
 * press is its own object, so a read settles only the press it was sent with.
 */
export interface XSettingMark {
  readonly value: string;
}
export const xSettingsMarksAtom = Atom.make<ReadonlyMap<string, XSettingMark>>(new Map()).pipe(
  Atom.keepAlive,
);

export const markKey = (accountId: number, key: string) => `${accountId} ${key}`;

/** The keys among `values` that show the change the user made in Xtend. */
export const pressedIn = (
  marks: ReadonlyMap<string, XSettingMark>,
  accountId: number,
  values: ReadonlyArray<XSettingValue>,
) =>
  values.filter((v) => marks.get(markKey(accountId, v.key))?.value === v.value).map((v) => v.key);

/**
 * `marks` once the log filed `logged` for a read sent while the marks were `sent`: each filed key's
 * mark settles, unless the user pressed it again since, which keeps the newer press theirs.
 */
export const settleMarks = (
  marks: ReadonlyMap<string, XSettingMark>,
  sent: ReadonlyMap<string, XSettingMark>,
  accountId: number,
  logged: ReadonlyArray<{ readonly key: string }>,
) => {
  const next = new Map(marks);
  for (const { key } of logged) {
    const k = markKey(accountId, key);
    if (next.get(k) === sent.get(k)) next.delete(k);
  }
  return next;
};

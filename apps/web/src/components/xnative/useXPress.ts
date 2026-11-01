import { RegistryContext, useAtomSet } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useContext } from "react";

import { settingsAtom } from "../../state/settings";
import { xToastUndo, type XMenuOutcome } from "../../state/x";
import { toastAtom } from "../ui/toast";

/** The user's clicks on X's own buttons and menu rows, from a native screen. */
export function useXPress() {
  const setToast = useAtomSet(toastAtom);
  const registry = useContext(RegistryContext);
  /**
   * Why X's buttons may not write as the user now: only once Settings says session actions are
   * on. Read at the press, from the app's registry, so an Undo outliving the screen sees it too.
   */
  const blocked = () => {
    const now = AsyncResult.getOrElse(registry.get(settingsAtom), () => null);
    return now === null
      ? "Your settings are still loading. Try again in a moment."
      : now.sessionPostingEnabled
        ? null
        : "Session actions are off in Settings, X session.";
  };
  /**
   * Presses one of X's menu rows (`row`); X's toast comes back as Xtend's, with X's Undo, after
   * which `undone` runs.
   */
  const pressRow = async (row: () => Promise<XMenuOutcome | null>, undone?: () => void) => {
    const why = blocked();
    if (why !== null) return setToast({ text: why });
    // An earlier press's toast goes: X's toast is now this press's, so its Undo would undo this one.
    setToast(null);
    const outcome = await row();
    if (outcome === null) return setToast({ text: "X did not take that. Try again in a moment." });
    if (outcome.kind === "done" && outcome.toast !== null)
      setToast({
        text: outcome.toast,
        ...(outcome.undo
          ? {
              undo: async () => {
                const no = blocked();
                if (no !== null) throw new Error(no);
                if (!(await xToastUndo())) throw new Error("X no longer offers Undo here.");
                undone?.();
              },
            }
          : {}),
      });
  };
  return { blocked, pressRow, setToast };
}

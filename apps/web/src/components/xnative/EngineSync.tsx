import { useAtomSet } from "@effect/atom-react";
import { useEffect } from "react";

import { engineAtom, mergeBatch, updateEngine } from "../../state/engine";

/** Feeds Xtend's own X screens: every response the X engine received, into the one store. */
export function EngineSync() {
  const setEngine = useAtomSet(engineAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- subscribes to the desktop bridge's engine batches while mounted.
  useEffect(
    () =>
      window.desktopBridge?.onEngine((batch) =>
        setEngine(updateEngine((s) => mergeBatch(s, batch))),
      ),
    [setEngine],
  );
  return null;
}

import { useAtomSet } from "@effect/atom-react";
import { useEffect } from "react";

import { engineAtom, mergeBatch, updateEngine } from "../../state/engine";

/** Feeds Xtend's own X screens: every response the X engine received, into the one store. */
export function EngineSync() {
  const setEngine = useAtomSet(engineAtom);
  useEffect(
    () =>
      window.desktopBridge?.onEngine((batch) =>
        setEngine(updateEngine((s) => mergeBatch(s, batch))),
      ),
    [setEngine],
  );
  return null;
}

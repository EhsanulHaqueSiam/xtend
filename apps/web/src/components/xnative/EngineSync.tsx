import { useAtomSet } from "@effect/atom-react";
import { useEffect } from "react";

import { engineAtom, mergeBatch, updateEngine } from "../../state/engine";
import { grokLegacyAtom, listenGrokLegacy } from "../../state/grokLegacy";
import { xHeard } from "../../state/x";

/**
 * Feeds Xtend's own X screens: every response the X engine received, into the one store, and X's
 * older Grok client's traffic into the window's own Grok store, whichever screen is open.
 */
export function EngineSync() {
  const setEngine = useAtomSet(engineAtom);
  const setGrok = useAtomSet(grokLegacyAtom);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- subscribes to the desktop bridge's Grok captures for the app's life.
  useEffect(() => listenGrokLegacy(setGrok), [setGrok]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- subscribes to the desktop bridge's engine batches while mounted.
  useEffect(
    () =>
      window.desktopBridge?.onEngine((batch) => {
        xHeard(batch);
        setEngine(updateEngine((s) => mergeBatch(s, batch)));
      }),
    [setEngine],
  );
  return null;
}

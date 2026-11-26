import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect } from "react";

import { engineAtom, longPostsAtom, mergeBatch, updateEngine } from "../../state/engine";
import { grokLegacyAtom, listenGrokLegacy } from "../../state/grokLegacy";
import { settingsAtom, updateSettingsAtom } from "../../state/settings";
import { xHeard } from "../../state/x";

/**
 * Feeds Xtend's own X screens: every response the X engine received, into the one store, and X's
 * older Grok client's traffic into the window's own Grok store, whichever screen is open. What X
 * says about longer posts goes to the service, which checks queued posts against it.
 */
export function EngineSync() {
  const setEngine = useAtomSet(engineAtom);
  const setGrok = useAtomSet(grokLegacyAtom);
  const longPosts = useAtomValue(longPostsAtom);
  const stored = AsyncResult.getOrElse(
    AsyncResult.map(useAtomValue(settingsAtom), (s) => s.longPosts),
    () => undefined,
  );
  const update = useAtomSet(updateSettingsAtom, { mode: "promise" });
  const refreshSettings = useAtomRefresh(settingsAtom);
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
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- stores X's word on longer posts in the service's settings once settings loaded and X's word differs.
  useEffect(() => {
    if (longPosts === null || stored === undefined || stored === longPosts) return;
    void update({ longPosts }).then(refreshSettings, () => undefined);
  }, [longPosts, stored, update, refreshSettings]);
  return null;
}

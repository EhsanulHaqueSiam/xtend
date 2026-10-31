import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XTitle } from "../components/xnative/XColumn";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { settingsAtom } from "../state/settings";
import { xNavigate } from "../state/x";

/** X's bookmarks, drawn by Xtend from the engine on x.com/i/bookmarks. */
function BookmarksScreen() {
  const setEngine = useAtomSet(engineAtom);
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  const open = useCallback(() => void xNavigate("https://x.com/i/bookmarks"), []);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "bookmarks")));
    open();
  }, [open, setEngine]);
  return (
    <Timeline
      surface="bookmarks"
      header={<XTitle title="Bookmarks" detail={handle === null ? undefined : `@${handle}`} />}
      empty="Loading your bookmarks from X."
      onReopen={open}
    />
  );
}

export const Route = createFileRoute("/bookmarks")({ component: BookmarksScreen });

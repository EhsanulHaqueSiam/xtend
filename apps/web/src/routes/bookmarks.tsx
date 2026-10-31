import { useAtomSet } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { PageHeader } from "../components/PageHeader";
import { Timeline } from "../components/xnative/Timeline";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

/** X's bookmarks, drawn by Xtend from the engine on x.com/i/bookmarks. */
function BookmarksScreen() {
  const setEngine = useAtomSet(engineAtom);
  const open = useCallback(() => void xNavigate("https://x.com/i/bookmarks"), []);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "bookmarks")));
    open();
  }, [open, setEngine]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Bookmarks" detail="on X · your session" />
      <Timeline surface="bookmarks" empty="Loading your bookmarks from X." onReopen={open} />
    </div>
  );
}

export const Route = createFileRoute("/bookmarks")({ component: BookmarksScreen });

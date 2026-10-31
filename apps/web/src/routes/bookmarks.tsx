import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XTitle } from "../components/xnative/XColumn";
import { settingsAtom } from "../state/settings";
import { xGo, xNavigate } from "../state/x";

/** X's bookmarks, drawn by Xtend from the engine on x.com/i/bookmarks. */
function BookmarksScreen() {
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  // Through X's router: a page X still holds shows from its cache, and the store keeps its posts.
  const open = useCallback(() => void xGo("https://x.com/i/bookmarks"), []);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () => void xNavigate("https://x.com/i/bookmarks");

  useEffect(open, [open]);
  return (
    <Timeline
      surface="bookmarks"
      header={<XTitle title="Bookmarks" detail={handle === null ? undefined : `@${handle}`} />}
      empty="Loading your bookmarks from X."
      onReopen={reload}
    />
  );
}

export const Route = createFileRoute("/bookmarks")({ component: BookmarksScreen });

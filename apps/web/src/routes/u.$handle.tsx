import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { fmt } from "../components/analyze/ui";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Timeline } from "../components/xnative/Timeline";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

/** A profile's posts, drawn by Xtend from the engine on x.com/<handle>; Xtend's tools sit beside them. */
function ProfileScreen() {
  const { handle } = Route.useParams();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const setEngine = useAtomSet(engineAtom);
  const open = useCallback(() => void xNavigate(`https://x.com/${handle}`), [handle]);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "profile")));
    open();
  }, [open, setEngine]);
  // Who they are, from any post of theirs the engine has seen; X's profile card is not read yet.
  const author = [...engine.posts.values()].find(
    (p) => p.author.handle.toLowerCase() === handle.toLowerCase(),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={author?.author.name ?? `@${handle}`}
        detail={
          author === undefined || author.author.followers === null
            ? `@${handle}`
            : `@${handle} · ${fmt(author.author.followers)} followers`
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigate({ href: `/scores?tab=report&handle=${handle}` })}
            >
              Score report
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.desktopBridge?.openExternal(`https://x.com/${handle}`)}
            >
              Open in browser
            </Button>
          </>
        }
      />
      <Timeline surface="profile" empty={`Loading @${handle}'s posts from X.`} onReopen={open} />
    </div>
  );
}

export const Route = createFileRoute("/u/$handle")({ component: ProfileScreen });

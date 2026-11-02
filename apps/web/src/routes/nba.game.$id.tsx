import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { GameHeader, ScoreStrip } from "../components/xnative/Sports";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs, XTitle } from "../components/xnative/XColumn";
import { isElectron } from "../env";
import { engineAtom, gameSurface } from "../state/engine";
import { xGo, xNavigate, xPanelOpenAtom, xPickGameTab } from "../state/x";

// X's tabs, switched in place on one URL. Xtend draws Top and Latest; the rest open X's page.
const TABS = [
  { id: "top", label: "Top" },
  { id: "latest", label: "Latest" },
  { id: "highlights", label: "Highlights" },
  { id: "stats", label: "Stats" },
  { id: "plays", label: "Plays" },
  { id: "chat", label: "Chat" },
] as const;

/**
 * An NBA game, drawn by Xtend from the engine on x.com/i/nba/game/<id>: the day's score strip, X's
 * header (teams, scores, clock, timeouts, the last play), then the posts of X's Top or Latest tab,
 * which the engine presses in place on X's page.
 */
function GameScreen() {
  const { id } = Route.useParams();
  const latest = Route.useSearch().tab === "latest";
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const setPanel = useAtomSet(xPanelOpenAtom);
  const game = engine.games.get(id);
  const url = `https://x.com/i/nba/game/${id}`;
  const tab = latest ? "Latest" : "Top";
  // Leaving the game or its tab ends a tab pick still waiting on X's load.
  const live = useRef(new AbortController());
  const pick = useCallback(
    (loaded: Promise<unknown>) => void xPickGameTab(id, tab, loaded, live.current.signal),
    [id, tab],
  );
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this game's X page and picks X's tab there while it is open.
  useEffect(() => {
    live.current = new AbortController();
    pick(xGo(url));
    const mine = live.current;
    return () => mine.abort();
  }, [url, pick]);
  // ⌘R and "Load again": X's page in full, since X's router does nothing on the page it shows.
  const reload = () => pick(xNavigate(url));
  // X's own page with its tabs, beside the tool; a browser opens it in a tab.
  const openOnX = () =>
    isElectron ? setPanel(true) : void window.open(url, "_blank", "noreferrer");

  const teams =
    game?.away.abbreviation == null || game.home.abbreviation == null
      ? "Game"
      : `${game.away.abbreviation} @ ${game.home.abbreviation}`;
  return (
    <Timeline
      surface={gameSurface(id, tab)}
      header={<XTitle title={teams} onBack={() => router.history.back()} />}
      top={
        <div data-x="game-page">
          <ScoreStrip gameId={id} />
          {game === undefined ? null : <GameHeader game={game} />}
          <div className="border-b border-border">
            <XTabs
              label="Game"
              tabs={TABS}
              value={latest ? "latest" : "top"}
              onChange={(next) =>
                next === "top" || next === "latest"
                  ? void navigate({
                      to: "/nba/game/$id",
                      params: { id },
                      search: next === "latest" ? { tab: next } : {},
                      replace: true,
                    })
                  : openOnX()
              }
            />
          </div>
        </div>
      }
      empty="Loading the game from X."
      onReopen={reload}
    />
  );
}

export const Route = createFileRoute("/nba/game/$id")({
  // Top is the default, so a link to a game needs no tab.
  validateSearch: (s: Record<string, unknown>): { tab?: "latest" } =>
    s.tab === "latest" ? { tab: "latest" } : {},
  component: GameScreen,
});

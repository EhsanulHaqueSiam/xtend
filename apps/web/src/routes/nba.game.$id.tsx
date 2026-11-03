import { useAtom, useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { GameHeader, ScoreStrip } from "../components/xnative/Sports";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs, XTitle } from "../components/xnative/XColumn";
import { isElectron } from "../env";
import { engineAtom, gameSurface } from "../state/engine";
import { isXRoute, xGo, xLeave, xNavigate, xPanelOpenAtom, xPickGameTab } from "../state/x";

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
  const [panelOpen, setPanel] = useAtom(xPanelOpenAtom);
  const game = engine.games.get(id);
  const url = `https://x.com/i/nba/game/${id}`;
  const tab = latest ? "Latest" : "Top";
  // The teams X's score hero names when X serves this game from its cache; by value, so a new
  // score does not pick the tab again.
  const [awayName, awayAbbr, homeName, homeAbbr] = [
    game?.away.name ?? null,
    game?.away.abbreviation ?? null,
    game?.home.name ?? null,
    game?.home.abbreviation ?? null,
  ];
  const sides = useMemo(
    () =>
      awayName === null && awayAbbr === null
        ? undefined
        : {
            away: { name: awayName, abbreviation: awayAbbr },
            home: { name: homeName, abbreviation: homeAbbr },
          },
    [awayName, awayAbbr, homeName, homeAbbr],
  );
  // Leaving the game or its tab ends a tab pick still waiting on X's load.
  const live = useRef(new AbortController());
  const pick = useCallback(
    (loaded: Promise<unknown>) => void xPickGameTab(id, tab, loaded, live.current.signal, sides),
    [id, tab, sides],
  );
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this game's X page and picks X's tab there while it is open.
  useEffect(() => {
    live.current = new AbortController();
    pick(xGo(url));
    const mine = live.current;
    return () => mine.abort();
  }, [url, pick]);
  // Leaving for a screen that moves the engine nowhere (Analyze, Settings) takes it off the game,
  // so X stops re-polling a live game nobody sees; X's own page in view (the panel, /x) keeps it.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- parks the engine (the session view) when the user leaves this game's screen.
  useEffect(
    () => () => {
      const where = () => router.state.location.pathname;
      xLeave(
        `/i/nba/game/${id}`,
        () => panelOpen || isXRoute(where()) || where() === `/nba/game/${id}`,
      );
    },
    [id, panelOpen, router],
  );
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
      header={
        <XTitle
          title={teams}
          onBack={() => router.history.back()}
          // X's league page: its schedule, standings and stat leaders.
          actions={
            <Link
              to="/nba"
              search={{ tab: "games" }}
              className="rounded-full px-3 py-1 text-[15px] font-bold transition-colors duration-150 hover:bg-white/10"
            >
              NBA
            </Link>
          }
        />
      }
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

import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EngineGame, EngineGameTeam } from "@xtend/contracts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useRef } from "react";

import { engineAtom } from "../../state/engine";

/**
 * X's NBA pages as Xtend draws them from what X sent: a team's schedule on its profile, the day's
 * score strip and a game's header. Each card and strip entry opens the game's own page.
 */

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

const phase = (g: EngineGame) =>
  g.status === "COMPLETED" ? "final" : g.status === "IN_PROGRESS" ? "live" : "upcoming";

/** "Q3", "OT", or "Half" at halftime; "" before X names a period. */
const periodOf = (g: EngineGame) =>
  g.halftime === true
    ? "Half"
    : g.period === null
      ? ""
      : /OVERTIME/.test(g.periodType ?? "")
        ? "OT"
        : `Q${g.period}`;

/** X's two lines above a game's teams: "Final", "LIVE / Q3 00:00", "Nov 3 / 9:00 AM". */
const statusLines = (g: EngineGame): readonly [string, string] => {
  const when = phase(g);
  if (when === "final") return ["Final", ""];
  if (when === "live")
    return ["LIVE", `${periodOf(g)} ${g.halftime === true ? "" : (g.clock ?? "")}`.trim()];
  return g.startsAt === null
    ? ["", ""]
    : [DAY.format(new Date(g.startsAt)), TIME.format(new Date(g.startsAt))];
};

const abbr = (t: EngineGameTeam) => t.abbreviation ?? "";

/** One game in X's schedule card form: status lines, then away and home with their scores. */
export function GameCard({ game }: { readonly game: EngineGame }) {
  const [first, second] = statusLines(game);
  const scored = phase(game) !== "upcoming";
  return (
    <Link
      to="/nba/game/$id"
      params={{ id: game.gameId }}
      data-x="game-card"
      className="block w-[132px] rounded-2xl border border-border px-3 py-2 text-[13px] leading-5 transition-colors duration-150 hover:bg-white/[0.03]"
    >
      <span className={`block font-bold ${first === "LIVE" ? "text-[#f4212e]" : ""}`}>{first}</span>
      <span className="block min-h-5 text-[#71767b]">{second}</span>
      {(["away", "home"] as const).map((at) => (
        <span key={at} className="mt-1 flex justify-between text-[15px] font-bold">
          {abbr(game[at])}
          {scored && game[at].points !== null ? <span>{game[at].points}</span> : null}
        </span>
      ))}
    </Link>
  );
}

/**
 * X's schedule on a team's profile, between its header and tabs: a card per game, scrolled
 * sideways, opening on the first game not over. Nothing for an account X gives no schedule.
 */
export function TeamSchedule({ userId }: { readonly userId: string }) {
  const engine = useAtomValue(engineAtom);
  const list = useRef<HTMLUListElement | null>(null);
  // Once per mount: later captures must not pull the row back from where the user scrolled it.
  const startAt = useCallback((el: HTMLUListElement | null) => {
    list.current = el;
    const now = el?.querySelector<HTMLElement>("[data-now]");
    if (el && now) el.scrollLeft = now.offsetLeft - el.offsetLeft - 16;
  }, []);
  const games = (engine.schedules.get(userId) ?? []).flatMap((id) => engine.games.get(id) ?? []);
  if (games.length === 0) return null;
  const now = games.find((g) => phase(g) !== "final")?.gameId;
  const page = (by: number) =>
    list.current?.scrollBy({ left: by * list.current.clientWidth, behavior: "smooth" });
  const arrow =
    "absolute top-1/2 z-10 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-black/80 transition-colors duration-150 hover:bg-[#181919]";
  return (
    <section
      data-x="team-schedule"
      aria-label="Schedule"
      className="relative border-t border-border"
    >
      <button
        type="button"
        aria-label="Previous"
        className={`${arrow} left-1`}
        onClick={() => page(-1)}
      >
        <ChevronLeft className="size-4" />
      </button>
      <ul
        ref={startAt}
        className="flex snap-x gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]"
      >
        {games.map((g) => (
          <li
            key={g.gameId}
            className="shrink-0 snap-start"
            data-now={g.gameId === now || undefined}
          >
            <GameCard game={g} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Next"
        className={`${arrow} right-1`}
        onClick={() => page(1)}
      >
        <ChevronRight className="size-4" />
      </button>
    </section>
  );
}

/** One strip entry as X words it: "BOS Final 108-97 ORL", "LAC Q4 GSW", "MIA 9:00 AM LAL". */
const stripText = (g: EngineGame) => {
  const when = phase(g);
  const middle =
    when === "final"
      ? `Final ${g.away.points ?? ""}-${g.home.points ?? ""}`
      : when === "live"
        ? periodOf(g) || "LIVE"
        : g.startsAt === null
          ? ""
          : TIME.format(new Date(g.startsAt));
  return [abbr(g.away), middle, abbr(g.home)].filter((part) => part !== "").join(" ");
};

/** X's score strip atop a game: the day's games, this one marked, each opening its own page. */
export function ScoreStrip({ gameId }: { readonly gameId: string }) {
  const engine = useAtomValue(engineAtom);
  const day = (engine.gameDays.get(gameId) ?? []).flatMap((id) => engine.games.get(id) ?? []);
  if (day.length === 0) return null;
  return (
    <nav
      aria-label="Today's games"
      className="flex overflow-x-auto border-b border-border [scrollbar-width:none]"
    >
      {day.map((g) => (
        <Link
          key={g.gameId}
          to="/nba/game/$id"
          params={{ id: g.gameId }}
          aria-current={g.gameId === gameId ? "page" : undefined}
          className="shrink-0 px-4 py-2.5 text-[13px] whitespace-nowrap text-[#71767b] transition-colors duration-150 hover:bg-white/[0.03] aria-[current=page]:font-bold aria-[current=page]:text-foreground"
        >
          {stripText(g)}
        </Link>
      ))}
    </nav>
  );
}

function Side({ team, end }: { readonly team: EngineGameTeam; readonly end?: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${end === true ? "flex-row-reverse text-right" : ""}`}
    >
      <div className="min-w-0">
        <p className="truncate text-[17px] font-bold">{team.name ?? abbr(team)}</p>
        <p className="text-[13px] text-[#71767b]">{abbr(team)}</p>
      </div>
      <p data-x="points" className="ml-auto text-[32px] leading-none font-extrabold tabular-nums">
        {team.points ?? ""}
      </p>
    </div>
  );
}

/** "3 of 7 timeouts remaining", and "Bonus" when the side is in it. */
const sideNotes = (t: EngineGameTeam) =>
  [
    t.timeouts === null ? null : `${t.timeouts} of 7 timeouts remaining`,
    t.bonus === true ? "Bonus" : null,
  ]
    .filter((n) => n !== null)
    .join(" · ");

/**
 * X's game header: both teams and scores either side of the status (Final, or LIVE with period
 * and clock, or the start), each side's timeouts and bonus while it is live, then the last play.
 */
export function GameHeader({ game }: { readonly game: EngineGame }) {
  const [first, second] = statusLines(game);
  const live = phase(game) === "live";
  return (
    <section data-x="game" className="border-b border-border px-4 py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        <Side team={game.away} />
        <div className="text-center text-[13px] leading-5">
          <p className={`font-bold ${live ? "text-[#f4212e]" : ""}`}>{first}</p>
          {second === "" ? null : <p className="text-[#71767b]">{second}</p>}
        </div>
        <Side team={game.home} end />
      </div>
      {live ? (
        <div className="mt-2 grid grid-cols-2 gap-4 text-[13px] text-[#71767b]">
          <p>{sideNotes(game.away)}</p>
          <p className="text-right">{sideNotes(game.home)}</p>
        </div>
      ) : null}
      {game.lastPlay === null ? null : (
        <div className="mt-3 border-t border-border pt-3 text-[15px] leading-5">
          <p className="text-[13px] font-bold uppercase">{game.lastPlay.kind}</p>
          <p>{game.lastPlay.description}</p>
        </div>
      )}
    </section>
  );
}

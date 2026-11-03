import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import type { EngineRecord, EngineStanding } from "@xtend/contracts";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { Menu, MenuItem } from "../components/ui/menu";
import { GameCard } from "../components/xnative/Sports";
import { XColumn, XTabs, XTitle } from "../components/xnative/XColumn";
import { XEmpty } from "../components/xnative/XRows";
import { cn } from "../lib/utils";
import { engineAtom } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

/** X's league tabs, each its own page under x.com/i/nba. */
const TABS = [
  { id: "games", label: "Schedule" },
  { id: "standings", label: "Standings" },
  { id: "players", label: "Stats" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const record = (r: EngineRecord | null) => (r === null ? "–" : `${r.wins}-${r.losses}`);
const decimal = (n: number | null) => (n === null ? "–" : n.toFixed(1));
// X writes a win share without its leading zero, as standings do.
const share = (t: EngineStanding) =>
  t.wins + t.losses === 0 ? "–" : (t.wins / (t.wins + t.losses)).toFixed(3).replace(/^0/, "");

/** X's standings columns, in X's order. */
const COLUMNS: ReadonlyArray<readonly [string, (t: EngineStanding) => string]> = [
  ["W", (t) => String(t.wins)],
  ["L", (t) => String(t.losses)],
  ["PCT", share],
  ["GB", (t) => (t.gamesBack === null || t.gamesBack === 0 ? "–" : String(t.gamesBack))],
  ["Home", (t) => record(t.home)],
  ["Away", (t) => record(t.road)],
  ["Div", (t) => record(t.division)],
  ["Conf", (t) => record(t.conference)],
  ["PPG", (t) => decimal(t.pointsFor)],
  ["Opp PPG", (t) => decimal(t.pointsAgainst)],
  [
    "Diff",
    (t) => (t.pointDiff === null ? "–" : `${t.pointDiff > 0 ? "+" : ""}${t.pointDiff.toFixed(1)}`),
  ],
  ["Strk", (t) => t.streak ?? "–"],
  ["L10", (t) => record(t.lastTen)],
];

const cell = "px-2 py-2 text-right font-mono text-[13px] tabular-nums whitespace-nowrap";

function Standings() {
  const conferences = useAtomValue(engineAtom).standings;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = conferences.find((c) => c.name === picked) ?? conferences[0];
  if (shown === undefined) return null;
  return (
    <div data-x="standings">
      <div className="border-b border-border">
        <XTabs
          label="Conference"
          tabs={conferences.map((c) => ({ id: c.name, label: c.name }))}
          value={shown.name}
          onChange={setPicked}
        />
      </div>
      {shown.divisions.map((d) => (
        <section key={d.name} className="overflow-x-auto border-b border-border">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[13px] text-[#71767b]">
                <th className="px-4 py-2 text-left font-bold text-foreground">{d.name}</th>
                {COLUMNS.map(([label]) => (
                  <th key={label} className={cn(cell, "font-normal")}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.teams.map((t, i) => (
                <tr key={t.teamId} className="border-t border-border">
                  <td className="px-4 py-2 text-[15px] whitespace-nowrap">
                    <span className="mr-3 inline-block w-4 text-right text-[#71767b]">{i + 1}</span>
                    <span className="font-bold">{t.abbreviation}</span>
                  </td>
                  {COLUMNS.map(([label, value]) => (
                    <td key={label} className={cell}>
                      {value(t)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function Leaders() {
  const categories = useAtomValue(engineAtom).leaders;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = categories.find((c) => c.key === picked) ?? categories[0];
  if (shown === undefined) return null;
  return (
    <div data-x="leaders">
      <div className="flex justify-end border-b border-border px-4 py-2">
        <Menu
          align="end"
          label="Stat"
          trigger={
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 text-[15px] font-bold"
            >
              {shown.title}
              <ChevronDown className="size-4" />
            </button>
          }
        >
          {categories.map((c) => (
            <MenuItem key={c.key} onClick={() => setPicked(c.key)}>
              {c.title}
              {c.key === shown.key ? <Check className="ml-auto size-3.5" /> : null}
            </MenuItem>
          ))}
        </Menu>
      </div>
      <ol>
        {shown.leaders.map((l) => (
          <li
            key={`${l.rank}-${l.name}`}
            className="flex items-center gap-3 border-b border-border px-4 py-2 text-[15px]"
          >
            <span className="w-5 text-right text-[#71767b]">{l.rank}</span>
            {l.headshotUrl === null ? null : (
              <img alt="" src={l.headshotUrl} className="size-8 rounded-full object-cover" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold">{l.name}</span>
              {l.position === null ? null : (
                <span className="ml-2 text-[#71767b]">{l.position}</span>
              )}
            </span>
            <span className="font-mono tabular-nums">{l.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * X's NBA league page, drawn by Xtend from the engine on x.com/i/nba: the day's games X's
 * Schedule shows, its Standings by conference, and its stat leaders. Each tab is X's own page.
 */
function LeagueScreen() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const url = `https://x.com/i/nba/${tab}`;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to the league's X page for the open tab.
  useEffect(() => void xGo(url), [url]);
  const games = (engine.nbaDay ?? []).flatMap((id) => engine.games.get(id) ?? []);
  const has =
    tab === "games"
      ? engine.nbaDay !== null
      : tab === "standings"
        ? engine.standings.length > 0
        : engine.leaders.length > 0;
  return (
    <XColumn header={<XTitle title="NBA" onBack={() => router.history.back()} />}>
      <div className="border-b border-border">
        <XTabs
          label="League"
          tabs={TABS}
          value={tab}
          onChange={(next) => void navigate({ to: "/nba", search: { tab: next }, replace: true })}
        />
      </div>
      {!has ? (
        <XEmpty key={tab} empty="Loading the league from X." onReopen={() => void xNavigate(url)} />
      ) : tab === "games" && games.length === 0 ? (
        <p className="px-4 py-8 text-center text-[15px] text-[#71767b]">No games on this day.</p>
      ) : tab === "games" ? (
        <ul data-x="league-games" className="flex flex-wrap gap-2 px-4 py-3">
          {games.map((g) => (
            <li key={g.gameId}>
              <GameCard game={g} />
            </li>
          ))}
        </ul>
      ) : tab === "standings" ? (
        <Standings />
      ) : (
        <Leaders />
      )}
    </XColumn>
  );
}

export const Route = createFileRoute("/nba/")({
  validateSearch: (s: Record<string, unknown>): { tab: Tab } => ({
    tab: TABS.find((t) => t.id === s.tab)?.id ?? "games",
  }),
  component: LeagueScreen,
});

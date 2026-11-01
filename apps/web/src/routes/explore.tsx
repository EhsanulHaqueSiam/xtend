import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EnginePost, EngineTrend, EngineUser } from "@xtend/contracts";
import { MoreHorizontal, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Menu, MenuItem } from "../components/ui/menu";
import { useOpenPost } from "../components/xnative/Timeline";
import { useXPress } from "../components/xnative/useXPress";
import { XColumn, XTabs } from "../components/xnative/XColumn";
import { xtendRoute } from "../components/xnative/RichText";
import { UserRow, XRows } from "../components/xnative/XRows";
import { XPostView } from "../components/xnative/XPostView";
import { type AnySurface, at, engineAtom, hideTrend, postOn, updateEngine } from "../state/engine";
import {
  xGo,
  xNavigate,
  xOverAtom,
  xOverEnded,
  xPickHomeTab,
  xShows,
  xTrendMenu,
  xTrendMenuPress,
} from "../state/x";

type Row =
  | { readonly kind: "group"; readonly name: string }
  | {
      readonly kind: "trend";
      readonly trend: EngineTrend;
      readonly surface: AnySurface;
      readonly index: number;
    }
  | { readonly kind: "user"; readonly user: EngineUser }
  | { readonly kind: "post"; readonly post: EnginePost };

/**
 * One trend as X lists it. A news story (X sends faces with it) leads with its headline; a plain
 * trend leads with where it trends.
 */
function TrendRow({
  trend,
  surface,
  index,
}: {
  readonly trend: EngineTrend;
  readonly surface: AnySurface;
  readonly index: number;
}) {
  const navigate = useNavigate();
  const { pressRow } = useXPress();
  const setOver = useAtomSet(xOverAtom);
  const setEngine = useAtomSet(engineAtom);
  // Undefined while X's rows are read, null when X's page shows no menu for it.
  const [rows, setRows] = useState<ReadonlyArray<string> | null | undefined>(undefined);
  const reading = useRef(0);
  const read = (open: boolean) => {
    const run = ++reading.current;
    if (!open) return;
    setRows(undefined);
    void xTrendMenu(trend.name).then((rows) => {
      if (run === reading.current) setRows(rows);
    });
  };
  const hide = (hidden: boolean) =>
    setEngine(updateEngine((s) => hideTrend(s, surface, trend, hidden, index)));
  const press = (label: string) =>
    void pressRow(
      async () => {
        const outcome = await xTrendMenuPress(trend.name, label, setOver);
        if (outcome?.kind === "done" && outcome.current && (outcome.toast !== null || outcome.gone))
          hide(true);
        return outcome;
      },
      () => hide(false),
    );
  const news = trend.images.length > 0;
  return (
    <div data-x="trend" className="relative">
      <button
        type="button"
        className="block w-full cursor-pointer py-3 pr-12 pl-4 text-left transition-colors duration-150 hover:bg-white/[0.03]"
        onClick={() =>
          void navigate({
            href: xtendRoute(trend.url) ?? `/search?q=${encodeURIComponent(trend.name)}`,
          })
        }
      >
        {news ? (
          <>
            <span className="line-clamp-2 text-[17px] leading-6 font-bold">{trend.name}</span>
            <span className="mt-1 flex items-center gap-2 text-[13px] text-[#71767b]">
              <span className="flex">
                {trend.images.slice(0, 3).map((src, i) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    className={`size-5 rounded-full border border-black object-cover ${i === 0 ? "" : "-ml-1.5"}`}
                  />
                ))}
              </span>
              <span className="truncate">{trend.context}</span>
            </span>
          </>
        ) : (
          <>
            <span className="block truncate text-[13px] text-[#71767b]">
              {trend.context ?? "Trending"}
            </span>
            <span className="block truncate text-[15px] leading-5 font-bold">{trend.name}</span>
          </>
        )}
      </button>
      <span className="absolute top-2 right-2">
        <Menu
          label="Trend actions"
          align="end"
          onOpenChange={read}
          trigger={
            <button
              type="button"
              aria-label="More"
              className="grid size-[34px] cursor-pointer place-items-center rounded-full text-[#71767b] transition-colors duration-150 hover:bg-[#1d9bf0]/10 hover:text-[#1d9bf0]"
            >
              <MoreHorizontal className="size-[18px]" />
            </button>
          }
        >
          {rows === undefined ? (
            <MenuItem disabled onClick={() => {}}>
              Loading from X
            </MenuItem>
          ) : rows === null ? (
            <MenuItem disabled onClick={() => {}}>
              X's page does not show this trend now
            </MenuItem>
          ) : (
            rows.map((label) => (
              <MenuItem key={label} onClick={() => press(label)}>
                {label}
              </MenuItem>
            ))
          )}
        </Menu>
      </span>
    </div>
  );
}

/**
 * X's Explore, drawn by Xtend from the engine on x.com/explore: X's own tabs (For you, Trending,
 * News, ...) with their trends and posts. A trend opens Xtend's search.
 */
function ExploreScreen() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const openPost = useOpenPost();
  const [q, setQ] = useState("");
  const tabs = engine.exploreTabs.map((t) => ({ id: t.timelineId, label: t.label }));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const surface: AnySurface | null = current === undefined ? null : `explore:${current.id}`;
  // X sends a tab whole, so nothing resets here. The first tab is what x.com/explore opens on;
  // the others are picked by their label once it has loaded.
  const label = current === undefined || current === tabs[0] ? null : current.label;
  const received = surface !== null && at(engine.trends, surface).length > 0;
  const receivedRef = useRef(received);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- keeps whether X's trends arrived for open() to read without re-running it.
  useEffect(() => {
    receivedRef.current = received;
  }, [received]);
  const setOver = useAtomSet(xOverAtom);
  // The tabs share a path, which is what ends a press elsewhere: leaving a tab by any way ends a
  // trend's press begun there, and X's dialog over it.
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- ends X's press and dialog when the open Explore tab changes.
  useEffect(
    () => () => {
      xOverEnded();
      setOver(false);
    },
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the open tab is the trigger: leaving it ends its press.
    [surface, setOver],
  );
  const open = useCallback(() => {
    const pick = () => (label === null ? undefined : xPickHomeTab(label));
    if (xShows("/explore") && receivedRef.current) void pick();
    else void xGo("https://x.com/explore").then(pick);
  }, [label]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () =>
    void xNavigate("https://x.com/explore").then(() =>
      label === null ? undefined : xPickHomeTab(label),
    );

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);

  const rows: Array<Row> = [];
  if (surface !== null) {
    let group: string | null = null;
    const hidden = new Set(at(engine.hiddenTrends, surface));
    for (const [index, trend] of at(engine.trends, surface).entries()) {
      if (hidden.has(trend.name)) continue;
      if (trend.group !== null && trend.group !== group)
        rows.push({ kind: "group", name: trend.group });
      group = trend.group;
      rows.push({ kind: "trend", trend, surface, index });
    }
    const people = at(engine.people, surface).flatMap((id) => engine.users.get(id) ?? []);
    if (people.length > 0) rows.push({ kind: "group", name: "Who to follow" });
    for (const user of people) rows.push({ kind: "user", user });
    const posts = at(engine.lists, surface).flatMap((id) => postOn(engine, surface, id) ?? []);
    if (posts.length > 0 && rows.length > 0) rows.push({ kind: "group", name: "Posts for you" });
    for (const post of posts) rows.push({ kind: "post", post });
  }
  return (
    <XColumn
      refresh={{ surfaces: surface === null ? [] : [surface], load: reload }}
      header={
        <>
          <form
            className="no-drag mx-4 mt-1.5 mb-1 flex h-[42px] items-center gap-3 rounded-full border border-transparent bg-[#202327] px-4 focus-within:border-[#1d9bf0] focus-within:bg-black"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim() !== "")
                void navigate({ to: "/search", search: { q: q.trim(), f: "top" } });
            }}
          >
            <Search className="size-4 shrink-0 text-[#71767b]" />
            <input
              aria-label="Search X"
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          {current === undefined ? null : (
            <XTabs
              label="Explore"
              tabs={tabs}
              value={current.id}
              onChange={(next) => void navigate({ to: "/explore", search: { tab: next } })}
            />
          )}
        </>
      }
    >
      <XRows
        waitKey={surface ?? "explore"}
        onReopen={reload}
        items={rows}
        rowKey={(r) =>
          r.kind === "group"
            ? `g:${r.name}`
            : r.kind === "trend"
              ? `t:${r.trend.name}`
              : r.kind === "user"
                ? `u:${r.user.userId}`
                : r.post.postId
        }
        empty="Loading what is happening from X."
        row={(r) =>
          r.kind === "group" ? (
            <h2 className="px-4 pt-3 pb-1 text-[20px] font-extrabold">{r.name}</h2>
          ) : r.kind === "trend" ? (
            <TrendRow key={surface} trend={r.trend} surface={r.surface} index={r.index} />
          ) : r.kind === "user" ? (
            <UserRow user={r.user} />
          ) : (
            <XPostView post={r.post} onOpen={openPost} />
          )
        }
      />
    </XColumn>
  );
}

export const Route = createFileRoute("/explore")({
  validateSearch: (s: Record<string, unknown>): { tab: string } => ({
    tab: typeof s.tab === "string" ? s.tab : "",
  }),
  component: ExploreScreen,
});

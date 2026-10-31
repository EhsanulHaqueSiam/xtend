import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { EnginePost, EngineTrend, EngineUser } from "@xtend/contracts";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useOpenPost } from "../components/xnative/Timeline";
import { XColumn, XTabs } from "../components/xnative/XColumn";
import { xtendRoute } from "../components/xnative/RichText";
import { UserRow, XRows } from "../components/xnative/XRows";
import { XPostView } from "../components/xnative/XPostView";
import { type AnySurface, at, engineAtom } from "../state/engine";
import { xGo, xPickHomeTab, xShows } from "../state/x";

type Row =
  | { readonly kind: "group"; readonly name: string }
  | { readonly kind: "trend"; readonly trend: EngineTrend }
  | { readonly kind: "user"; readonly user: EngineUser }
  | { readonly kind: "post"; readonly post: EnginePost };

/**
 * One trend as X lists it. A news story (X sends faces with it) leads with its headline; a plain
 * trend leads with where it trends.
 */
function TrendRow({ trend }: { readonly trend: EngineTrend }) {
  const navigate = useNavigate();
  const news = trend.images.length > 0;
  return (
    <button
      type="button"
      data-x="trend"
      className="block w-full cursor-pointer px-4 py-3 text-left transition-colors duration-150 hover:bg-white/[0.03]"
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
  useEffect(() => {
    receivedRef.current = received;
  }, [received]);
  const open = useCallback(() => {
    const pick = () => (label === null ? undefined : xPickHomeTab(label));
    if (xShows("/explore") && receivedRef.current) void pick();
    else void xGo("https://x.com/explore").then(pick);
  }, [label]);
  useEffect(open, [open]);

  const rows: Array<Row> = [];
  if (surface !== null) {
    let group: string | null = null;
    // X may send the same tab twice as it settles; a trend shows once.
    const shown = new Set<string>();
    for (const trend of at(engine.trends, surface)) {
      if (shown.has(trend.name)) continue;
      shown.add(trend.name);
      if (trend.group !== null && trend.group !== group)
        rows.push({ kind: "group", name: trend.group });
      group = trend.group;
      rows.push({ kind: "trend", trend });
    }
    const people = at(engine.people, surface).flatMap((id) => engine.users.get(id) ?? []);
    if (people.length > 0) rows.push({ kind: "group", name: "Who to follow" });
    for (const user of people) rows.push({ kind: "user", user });
    for (const id of at(engine.lists, surface)) {
      const post = engine.posts.get(id);
      if (post !== undefined) rows.push({ kind: "post", post });
    }
  }
  return (
    <XColumn
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
            <TrendRow trend={r.trend} />
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

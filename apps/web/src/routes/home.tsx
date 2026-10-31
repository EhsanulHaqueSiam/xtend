import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { HomeComposer } from "../components/xnative/HomeComposer";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs } from "../components/xnative/XColumn";
import { type AnySurface, at, engineAtom } from "../state/engine";
import { xNavigate, xPickHomeTab, xShows } from "../state/x";

const FEEDS = [
  { id: "forYou", label: "For you" },
  { id: "following", label: "Following" },
] as const;

/**
 * X's Home, drawn by Xtend: the engine sits on x.com/home on the chosen tab and feeds the list.
 * After For you and Following come the tabs the user pinned on X (topics, Lists, Communities),
 * as X names them; the engine picks each by its label.
 */
function HomeScreen() {
  const { feed } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const tabs = [...FEEDS, ...engine.homeTabs];
  const tab = tabs.find((t) => t.id === feed) ?? FEEDS[1];
  const surface = tab.id as AnySurface;
  // Already on Home with this feed received, X only switches tabs. Otherwise X loads Home again:
  // what X fetched before this screen was listening never reached it.
  const received = useRef(false);
  const has = at(engine.lists, surface).length > 0;
  useEffect(() => {
    received.current = has;
  }, [has]);
  const open = useCallback(() => {
    if (xShows("/home") && received.current) void xPickHomeTab(tab.label);
    else void xNavigate("https://x.com/home").then(() => xPickHomeTab(tab.label));
  }, [tab.label]);
  useEffect(open, [open]);
  return (
    <Timeline
      surface={surface}
      header={
        <XTabs
          label="Feed"
          tabs={tabs}
          value={tab.id}
          onChange={(next) => void navigate({ to: "/home", search: { feed: next } })}
        />
      }
      top={<HomeComposer />}
      keepPlace
      empty="Loading your timeline from X."
      onReopen={open}
    />
  );
}

export const Route = createFileRoute("/home")({
  // For you, Following, or a pinned tab's surface id (tag:…, list:…, community:…).
  validateSearch: (s: Record<string, unknown>): { feed: string } => ({
    feed: typeof s.feed === "string" && s.feed !== "" ? s.feed : "following",
  }),
  component: HomeScreen,
});

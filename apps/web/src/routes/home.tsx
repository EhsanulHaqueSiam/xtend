import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { HomeComposer } from "../components/xnative/HomeComposer";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs } from "../components/xnative/XColumn";
import { engineAtom } from "../state/engine";
import { xNavigate, xPickHomeTab, xShows } from "../state/x";

const FEEDS = [
  { id: "forYou", label: "For you" },
  { id: "following", label: "Following" },
] as const;
type Feed = (typeof FEEDS)[number]["id"];

/** X's Home, drawn by Xtend: the engine sits on x.com/home on the chosen tab and feeds the list. */
function HomeScreen() {
  const { feed } = Route.useSearch();
  const navigate = useNavigate();
  const engine = useAtomValue(engineAtom);
  const label = FEEDS.find((f) => f.id === feed)!.label;
  // Already on Home with this feed received, X only switches tabs. Otherwise X loads Home again:
  // what X fetched before this screen was listening never reached it.
  const received = useRef(false);
  const has = engine.lists[feed].length > 0;
  useEffect(() => {
    received.current = has;
  }, [has]);
  const open = useCallback(() => {
    if (xShows("/home") && received.current) void xPickHomeTab(label);
    else void xNavigate("https://x.com/home").then(() => xPickHomeTab(label));
  }, [label]);
  useEffect(open, [open]);
  return (
    <Timeline
      surface={feed}
      header={
        <XTabs
          label="Feed"
          tabs={FEEDS}
          value={feed}
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
  validateSearch: (s: Record<string, unknown>): { feed: Feed } => ({
    feed: s.feed === "forYou" ? "forYou" : "following",
  }),
  component: HomeScreen,
});

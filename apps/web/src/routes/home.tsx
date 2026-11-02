import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

import { HomeComposer } from "../components/xnative/HomeComposer";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs } from "../components/xnative/XColumn";
import { type AnySurface, at, engineAtom } from "../state/engine";
import { loadNewPosts, xGo, xNavigate, xPickHomeTab, xShows } from "../state/x";

// Away this long, Home asks X again on return. Bluesky checks after 30 s; X's own web does not.
const STALE_MS = 10 * 60_000;

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
  // Already on Home with this feed received, X only switches tabs. On Home without it, X loads Home
  // again: what X fetched before this screen was listening never reached it (a full reload, so
  // only then). From elsewhere, X's router brings Home back.
  const received = useRef(false);
  const has = at(engine.lists, surface).length > 0;
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- keeps whether X's posts arrived for open() to read without re-running it.
  useEffect(() => {
    received.current = has;
  }, [has]);
  const open = useCallback(() => {
    if (xShows("/home") && received.current) void xPickHomeTab(tab.label);
    else
      void (xShows("/home") ? xNavigate : xGo)("https://x.com/home").then(() =>
        xPickHomeTab(tab.label),
      );
  }, [tab.label]);
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  // ⌘R: X's Home in full, as reloading x.com does, then this tab again.
  const reload = useCallback(
    () => void xNavigate("https://x.com/home").then(() => xPickHomeTab(tab.label)),
    [tab.label],
  );
  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- listens for the window losing and regaining focus while Home shows.
  useEffect(() => {
    // Back after a long while, X loads Home again under the open list, so its newer posts wait
    // behind the pill and the place stays: nothing jumps under the reader.
    let left = 0;
    const leave = () => void (left ||= Date.now());
    const back = () => {
      if (left !== 0 && Date.now() - left >= STALE_MS) reload();
      left = 0;
    };
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [reload]);
  return (
    <Timeline
      surface={surface}
      header={
        <XTabs
          label="Feed"
          tabs={tabs}
          value={tab.id}
          // The open tab clicked again loads it fresh, as on X.
          onChange={(next) =>
            next === tab.id
              ? loadNewPosts()
              : void navigate({ to: "/home", search: { feed: next } })
          }
        />
      }
      top={<HomeComposer />}
      keepPlace
      empty="Loading your timeline from X."
      onReopen={open}
      onRefresh={reload}
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

import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useCallback, useEffect } from "react";

import { HomeComposer } from "../components/xnative/HomeComposer";
import { Timeline } from "../components/xnative/Timeline";
import { XTabs } from "../components/xnative/XColumn";
import { engineAtom } from "../state/engine";
import { settingsAtom } from "../state/settings";
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
  const handle = AsyncResult.getOrElse(useAtomValue(settingsAtom), () => null)?.handle ?? null;
  const label = FEEDS.find((f) => f.id === feed)!.label;
  // Already on Home, X only switches tabs; otherwise the tab is picked once the page has loaded.
  const open = useCallback(() => {
    if (xShows("/home")) void xPickHomeTab(label);
    else void xNavigate("https://x.com/home").then(() => xPickHomeTab(label));
  }, [label]);
  useEffect(open, [open]);
  // The user's own face, from any of their posts the engine has seen.
  const own =
    handle === null
      ? undefined
      : [...engine.posts.values()].find(
          (p) => p.author.handle.toLowerCase() === handle.toLowerCase(),
        );
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
      top={<HomeComposer avatarUrl={own?.avatarUrl ?? null} />}
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

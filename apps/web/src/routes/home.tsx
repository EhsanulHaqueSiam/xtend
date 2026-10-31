import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { HeaderTabs, PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Timeline } from "../components/xnative/Timeline";
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
  const label = FEEDS.find((f) => f.id === feed)!.label;
  // Already on Home, X only switches tabs; otherwise the tab is picked once the page has loaded.
  const open = useCallback(() => {
    if (xShows("/home")) void xPickHomeTab(label);
    else void xNavigate("https://x.com/home").then(() => xPickHomeTab(label));
  }, [label]);
  useEffect(open, [open]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Home"
        tabs={
          <HeaderTabs
            label="Feed"
            tabs={FEEDS}
            value={feed}
            onChange={(next) => void navigate({ to: "/home", search: { feed: next } })}
          />
        }
        detail="live · your session"
        actions={
          <Button size="sm" onClick={() => void navigate({ href: "/compose?new=1" })}>
            New post
          </Button>
        }
      />
      <Timeline surface={feed} empty="Loading your timeline from X." onReopen={open} />
    </div>
  );
}

export const Route = createFileRoute("/home")({
  validateSearch: (s: Record<string, unknown>): { feed: Feed } => ({
    feed: s.feed === "forYou" ? "forYou" : "following",
  }),
  component: HomeScreen,
});

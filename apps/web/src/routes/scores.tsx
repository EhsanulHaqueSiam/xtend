import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { MineSection, ReportSection } from "../components/scores/HandleReport";
import { Trending } from "../components/scores/Trending";
import { Watchlist } from "../components/scores/Watchlist";
import { useSection } from "../components/shell/sections";

/** The sidebar picks the section; each section draws its own header. */
function ScoresScreen() {
  const section = useSection("/scores");
  const { handle } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {section === "mine" ? (
        <MineSection />
      ) : section === "watchlist" ? (
        <Watchlist
          onOpen={(h) =>
            void navigate({ href: `/scores?tab=report&handle=${encodeURIComponent(h)}` })
          }
        />
      ) : section === "report" ? (
        <ReportSection key={handle ?? ""} handle={handle} />
      ) : section === "trending" ? (
        <Trending />
      ) : (
        <ReportSection key={handle ?? ""} handle={handle} botOnly />
      )}
    </div>
  );
}

export const Route = createFileRoute("/scores")({
  validateSearch: (s: Record<string, unknown>) => ({
    handle: typeof s.handle === "string" && s.handle !== "" ? s.handle.toLowerCase() : undefined,
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  // The palette and the overlay open /scores?handle=<h>: that is the Report section.
  beforeLoad: ({ search }) => {
    if (search.handle !== undefined && search.tab === undefined)
      throw redirect({
        to: "/scores",
        search: { tab: "report", handle: search.handle },
        replace: true,
      });
  },
  component: ScoresScreen,
});

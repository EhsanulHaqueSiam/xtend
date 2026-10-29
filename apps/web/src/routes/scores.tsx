import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { MineSection, ReportSection } from "../components/scores/HandleReport";
import { Watchlist } from "../components/scores/Watchlist";
import { useSection } from "../components/shell/sections";
import { parseHandle } from "../lib/utils";

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
      ) : (
        <ReportSection key={handle ?? ""} handle={handle} botOnly />
      )}
    </div>
  );
}

export const Route = createFileRoute("/scores")({
  // String(): the router parses search values as JSON, so an all-digit handle arrives as a number.
  validateSearch: (s: Record<string, unknown>) => ({
    handle: s.handle === undefined ? undefined : parseHandle(String(s.handle))?.toLowerCase(),
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

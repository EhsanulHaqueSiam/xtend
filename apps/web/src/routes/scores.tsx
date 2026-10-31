import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ReportSection } from "../components/scores/HandleReport";
import { Watchlist } from "../components/scores/Watchlist";
import { useSection } from "../components/shell/sections";
import { parseHandle } from "../lib/utils";

/** The sidebar picks the section; each section draws its own header. `linked` is `?handle=`. */
export function ScoresScreen({ linked }: { readonly linked: string | undefined }) {
  const section = useSection("/scores");
  const navigate = useNavigate();
  // The sidebar's section links carry only ?tab=, so Report keeps the last handle opened.
  const [handle, setHandle] = useState(linked);
  if (linked !== undefined && linked !== handle) setHandle(linked);
  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {section === "watchlist" ? (
        <Watchlist
          onOpen={(h) =>
            void navigate({ href: `/scores?tab=report&handle=${encodeURIComponent(h)}` })
          }
        />
      ) : (
        <ReportSection key={handle ?? ""} handle={handle} />
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
  component: function ScoresRoute() {
    return <ScoresScreen linked={Route.useSearch().handle} />;
  },
});

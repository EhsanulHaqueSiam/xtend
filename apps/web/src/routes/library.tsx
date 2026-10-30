import { createFileRoute, redirect } from "@tanstack/react-router";

import { ArchiveTab } from "../components/library/ArchiveTab";
import { CollectionsTab } from "../components/library/CollectionsTab";
import { PicksTab } from "../components/library/PicksTab";
import { SearchTab } from "../components/library/SearchTab";
import { SwipeTab } from "../components/library/SwipeTab";
import { TrendsTab } from "../components/library/TrendsTab";
import { useSection } from "../components/shell/sections";

/** The sidebar picks the section; each section draws its own header with its filters. */
function LibraryScreen() {
  const section = useSection("/library");
  const { q } = Route.useSearch();
  return (
    <div className="@container flex h-full min-w-0 flex-col">
      {section === "picks" ? (
        <PicksTab />
      ) : section === "search" ? (
        // A new `?q=` is a new search: remount so the query and results start from it.
        <SearchTab key={q ?? ""} initialQuery={q ?? ""} />
      ) : section === "archive" ? (
        <ArchiveTab />
      ) : section === "trends" ? (
        <TrendsTab />
      ) : section === "collections" ? (
        <CollectionsTab />
      ) : (
        <SwipeTab />
      )}
    </div>
  );
}

/** `?q=` fills the search box, priced, for a click; the palette and the header's Search X link here. */
export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  // A bare `?q=` link opens the Search section, so the sidebar shows where the user is.
  beforeLoad: ({ search }) => {
    if (search.q !== undefined && search.tab === undefined)
      throw redirect({ to: "/library", search: { tab: "search", q: search.q }, replace: true });
  },
  component: LibraryScreen,
});

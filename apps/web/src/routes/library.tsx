import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { ArchiveTab } from "../components/library/ArchiveTab";
import { CollectionsTab } from "../components/library/CollectionsTab";
import { PicksTab } from "../components/library/PicksTab";
import { SearchTab } from "../components/library/SearchTab";
import { SwipeTab } from "../components/library/SwipeTab";
import { TrendsTab } from "../components/library/TrendsTab";
import { HeaderTabs } from "../components/PageHeader";
import { Authors } from "../components/library/Authors";
import { PageHeader } from "../components/PageHeader";
import { SeenFeed } from "../components/SeenFeed";
import { PageBody } from "../components/ui/layout";
import { useSection } from "../components/shell/sections";

const SAVED_VIEWS = [
  { id: "all", label: "All saved" },
  { id: "collections", label: "Collections" },
] as const;

const SEEN_VIEWS = [
  { id: "posts", label: "Posts" },
  { id: "authors", label: "Authors" },
] as const;

/** What the session showed: every post, or the accounts that fill the feed. */
function Seen() {
  const [view, setView] = useState<(typeof SEEN_VIEWS)[number]["id"]>("posts");
  const tabs = <HeaderTabs label="View" tabs={SEEN_VIEWS} value={view} onChange={setView} />;
  if (view === "posts") return <SeenFeed tabs={tabs} />;
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Seen" tabs={tabs} />
      <PageBody>
        <Authors />
      </PageBody>
    </div>
  );
}

/** Saved posts, all of them as cards to search, or by collection. */
function Saved() {
  const [view, setView] = useState<(typeof SAVED_VIEWS)[number]["id"]>("all");
  const tabs = <HeaderTabs label="View" tabs={SAVED_VIEWS} value={view} onChange={setView} />;
  return view === "all" ? <SwipeTab tabs={tabs} /> : <CollectionsTab tabs={tabs} />;
}

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
      ) : section === "saved" ? (
        <Saved />
      ) : (
        <Seen />
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

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ArchiveTab } from "../components/library/ArchiveTab";
import { CollectionsTab } from "../components/library/CollectionsTab";
import { PicksTab } from "../components/library/PicksTab";
import { SearchTab } from "../components/library/SearchTab";
import { TabBar } from "../components/library/shared";
import { SwipeTab } from "../components/library/SwipeTab";
import { TrendsTab } from "../components/library/TrendsTab";
import { PageHeader } from "../components/PageHeader";

const TABS = [
  { id: "picks", label: "Picks" },
  { id: "search", label: "Search" },
  { id: "archive", label: "Archive" },
  { id: "trends", label: "Trends" },
  { id: "collections", label: "Collections" },
  { id: "swipe", label: "Swipe file" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Library as it opens on `q`. */
export function Library({ q }: { readonly q: string | undefined }) {
  const [tab, setTab] = useState<Tab>(q === undefined ? "picks" : "search");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Library" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === "picks" ? <PicksTab /> : null}
      {tab === "search" ? <SearchTab initialQuery={q ?? ""} /> : null}
      {tab === "archive" ? <ArchiveTab /> : null}
      {tab === "trends" ? <TrendsTab /> : null}
      {tab === "collections" ? <CollectionsTab /> : null}
      {tab === "swipe" ? <SwipeTab /> : null}
    </div>
  );
}

function LibraryScreen() {
  const { q } = Route.useSearch();
  // A new `?q=` while Library is open starts over on Search with it, not the old query.
  return <Library key={q} q={q} />;
}

/** `?q=` prefills and runs a search; Scores and the shell palette link here. */
export const Route = createFileRoute("/library")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" && search.q !== "" ? search.q : undefined,
  }),
  component: LibraryScreen,
});

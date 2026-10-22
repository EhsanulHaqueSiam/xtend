import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { CollectionsTab, SwipeTab } from "../components/library/CollectionsTab";
import { PicksTab } from "../components/library/PicksTab";
import { SearchTab } from "../components/library/SearchTab";
import { TabBar } from "../components/library/shared";
import { TrendsTab } from "../components/library/TrendsTab";
import { PageHeader } from "../components/PageHeader";

const TABS = [
  { id: "picks", label: "Daily picks" },
  { id: "search", label: "Search" },
  { id: "collections", label: "Collections" },
  { id: "swipe", label: "Swipe file" },
  { id: "trends", label: "Trends" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function LibraryScreen() {
  const q = Route.useSearch().q ?? "";
  // A `?q=` link (Scores sends them) lands on Search; otherwise the day's picks.
  const [tab, setTab] = useState<Tab>(q === "" ? "picks" : "search");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Library" detail="viral posts, picks, collections, swipe file, trends" />
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
      {tab === "picks" ? (
        <PicksTab />
      ) : tab === "search" ? (
        <SearchTab initialQuery={q} />
      ) : tab === "collections" ? (
        <CollectionsTab />
      ) : tab === "swipe" ? (
        <SwipeTab />
      ) : (
        <TrendsTab />
      )}
    </div>
  );
}

export const Route = createFileRoute("/library")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: LibraryScreen,
});

import { useAtomSet } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { HeaderTabs, PageHeader } from "../components/PageHeader";
import { Timeline } from "../components/xnative/Timeline";
import { engineAtom, resetSurface, updateEngine } from "../state/engine";
import { xNavigate } from "../state/x";

const KINDS = [
  { id: "top", label: "Top" },
  { id: "latest", label: "Latest" },
  { id: "media", label: "Media" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

/** X's search ran by the engine in the session, free; operators (from:, min_faves:) work as on X. */
function SearchScreen() {
  const { q, f } = Route.useSearch();
  const navigate = useNavigate();
  const setEngine = useAtomSet(engineAtom);
  const [draft, setDraft] = useState(q);
  const open = useCallback(() => {
    if (q === "") return;
    const tab = f === "latest" ? "&f=live" : f === "media" ? "&f=media" : "";
    xNavigate(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query${tab}`);
  }, [q, f]);
  useEffect(() => {
    setEngine(updateEngine((s) => resetSurface(s, "search")));
    open();
  }, [open, setEngine]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Search"
        tabs={
          <HeaderTabs
            label="Results"
            tabs={KINDS}
            value={f}
            onChange={(next) => void navigate({ to: "/search", search: { q, f: next } })}
          />
        }
        actions={
          <form
            className="flex h-7 w-72 items-center gap-1.5 rounded-[var(--control-radius)] border border-input px-2 focus-within:border-white/30"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ to: "/search", search: { q: draft.trim(), f } });
            }}
          >
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the screen exists to type a query
              autoFocus={q === ""}
              aria-label="Search X"
              placeholder="Search X, operators work"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-hidden placeholder:text-muted-foreground"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>
        }
      />
      <Timeline
        surface="search"
        empty={
          q === "" ? "Search X: words, @handles, or operators like min_faves:500." : "Searching X."
        }
        onReopen={open}
      />
    </div>
  );
}

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): { q: string; f: Kind } => ({
    q: typeof s.q === "string" ? s.q : "",
    f: s.f === "latest" || s.f === "media" ? s.f : "top",
  }),
  component: SearchScreen,
});

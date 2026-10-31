import { useAtomSet } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Timeline } from "../components/xnative/Timeline";
import { XTabs } from "../components/xnative/XColumn";
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
  const router = useRouter();
  const setEngine = useAtomSet(engineAtom);
  const [draft, setDraft] = useState(q);
  // A query opened from elsewhere (a hashtag, the palette) replaces what was typed.
  const [shownQ, setShownQ] = useState(q);
  if (q !== shownQ) {
    setShownQ(q);
    setDraft(q);
  }
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
    <Timeline
      surface="search"
      header={
        <>
          <div className="flex items-center gap-4 px-4 pt-1.5 pb-1">
            <button
              type="button"
              aria-label="Back"
              className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
              onClick={() => router.history.back()}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <form
              className="no-drag flex h-[42px] flex-1 items-center gap-3 rounded-full border border-transparent bg-[#202327] px-4 focus-within:border-[#1d9bf0] focus-within:bg-black"
              onSubmit={(e) => {
                e.preventDefault();
                void navigate({ to: "/search", search: { q: draft.trim(), f } });
              }}
            >
              <Search className="size-4 shrink-0 text-[#71767b]" />
              <input
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the screen exists to type a query
                autoFocus={q === ""}
                aria-label="Search X"
                placeholder="Search"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </form>
          </div>
          <XTabs
            label="Results"
            tabs={KINDS}
            value={f}
            onChange={(next) => void navigate({ to: "/search", search: { q, f: next } })}
          />
        </>
      }
      empty={
        q === "" ? "Search X: words, @handles, or operators like min_faves:500." : "Searching X."
      }
      onReopen={open}
    />
  );
}

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): { q: string; f: Kind } => ({
    q: typeof s.q === "string" ? s.q : "",
    f: s.f === "latest" || s.f === "media" ? s.f : "top",
  }),
  component: SearchScreen,
});

import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdvancedSearch } from "../components/xnative/AdvancedSearch";
import { Timeline } from "../components/xnative/Timeline";
import { XColumn, XTabs } from "../components/xnative/XColumn";
import { UserRow, XRows } from "../components/xnative/XRows";
import { at, engineAtom, type SearchProduct, searchSurface } from "../state/engine";
import { xGo, xNavigate } from "../state/x";

const KINDS = [
  { id: "top", label: "Top" },
  { id: "latest", label: "Latest" },
  { id: "people", label: "People" },
  { id: "media", label: "Media" },
] as const;
/** X's own `f=` for each tab; Top has none. */
const X_TAB: Readonly<Record<Kind, string>> = {
  top: "",
  latest: "&f=live",
  people: "&f=user",
  media: "&f=media",
};
/** The product X's results are keyed by, per tab. */
const PRODUCT: Readonly<Record<Kind, SearchProduct>> = {
  top: "Top",
  latest: "Latest",
  people: "People",
  media: "Media",
};
type Kind = (typeof KINDS)[number]["id"];

/** X's search ran by the engine in the session, free; operators (from:, min_faves:) work as on X. */
function SearchScreen() {
  const { q, f, advanced } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const engine = useAtomValue(engineAtom);
  const [draft, setDraft] = useState(q);
  // A query opened from elsewhere (a hashtag, the palette) replaces what was typed.
  const [shownQ, setShownQ] = useState(q);
  if (q !== shownQ) {
    setShownQ(q);
    setDraft(q);
  }
  const open = useCallback(() => {
    if (q === "") return;
    void xGo(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query${X_TAB[f]}`);
  }, [q, f]);
  // "Load again": a full load of the same page, since X's router does nothing on the page it shows.
  const reload = () =>
    void (q === ""
      ? undefined
      : xNavigate(`https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query${X_TAB[f]}`));

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- moves the engine (the session view) to this screen's X page while it is open.
  useEffect(open, [open]);
  // Each query and tab has its own key, so a search X still holds shows at once.
  const surface = searchSurface(PRODUCT[f], q);
  const header = (
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
            autoFocus={q === ""}
            aria-label="Search X"
            placeholder="Search"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-[#71767b]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
        <button
          type="button"
          aria-label="Advanced search"
          className="no-drag -m-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 hover:bg-white/10"
          onClick={() =>
            void navigate({ to: "/search", search: { q, f, advanced: true }, replace: true })
          }
        >
          <SlidersHorizontal className="size-5" />
        </button>
      </div>
      <AdvancedSearch
        open={advanced === true}
        query={q}
        onClose={() => void navigate({ to: "/search", search: { q, f }, replace: true })}
        onSearch={(next) => void navigate({ to: "/search", search: { q: next, f } })}
      />
      <XTabs
        label="Results"
        tabs={KINDS}
        value={f}
        onChange={(next) => void navigate({ to: "/search", search: { q, f: next } })}
      />
    </>
  );
  if (f === "people")
    return (
      <XColumn header={header}>
        <XRows
          waitKey={surface}
          onReopen={reload}
          items={at(engine.people, surface).flatMap((id) => engine.users.get(id) ?? [])}
          rowKey={(u) => u.userId}
          empty={q === "" ? "Search X for people by name or @handle." : "Searching X for people."}
          row={(u) => <UserRow user={u} />}
        />
      </XColumn>
    );
  return (
    <Timeline
      surface={surface}
      header={header}
      empty={
        q === "" ? "Search X: words, @handles, or operators like min_faves:500." : "Searching X."
      }
      onReopen={reload}
    />
  );
}

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): { q: string; f: Kind; advanced?: true } => ({
    q: typeof s.q === "string" ? s.q : "",
    f: s.f === "latest" || s.f === "media" || s.f === "people" ? s.f : "top",
    // X's advanced search over this one, so the palette and a link can open it.
    ...(s.advanced === true || s.advanced === "true" ? { advanced: true as const } : {}),
  }),
  component: SearchScreen,
});

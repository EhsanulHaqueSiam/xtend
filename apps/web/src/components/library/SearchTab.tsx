import { useAtomSet } from "@effect/atom-react";
import type { XPost, XSearchMode } from "@xtend/contracts";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { searchAtom } from "../../state/library";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Cost, Empty } from "../ui/layout";
import { DetailSplit } from "../ui/split";
import { xPill } from "../x";
import { PostGrid } from "./PostCard";
import { InspectorGroup, PostInspector } from "./PostInspector";
import { RemixButton, SaveButton, useSavedIds } from "./SaveButton";
import { ErrorLine, errorMessage } from "./shared";

const MODES = [
  { id: "top", label: "Top" },
  { id: "latest", label: "Latest" },
] as const satisfies ReadonlyArray<{ readonly id: XSearchMode; readonly label: string }>;

const excludedWords = (exclude: string) =>
  exclude
    .split(/[\s,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== "");

/**
 * Paid X search. Every run and every next page shows its price on the button.
 * Excluded words filter the results here, after they arrive.
 */
export function SearchTab({ initialQuery }: { readonly initialQuery: string }) {
  const search = useAtomSet(searchAtom, { mode: "promise" });
  const saved = useSavedIds();
  const [query, setQuery] = useState(initialQuery);
  const searchQuote = useQuoteLabel({ kind: "search", query });
  const [mode, setMode] = useState<XSearchMode>("top");
  const [exclude, setExclude] = useState("");
  const [items, setItems] = useState<ReadonlyArray<XPost>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const run = async (next?: string) => {
    if (query.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const page = await search({ query, mode, ...(next === undefined ? {} : { cursor: next }) });
      setItems((prev) => (next === undefined ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setSearched(true);
      if (next === undefined) setSelected(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // A `?q=` link (the palette, Scores, the header's Search X) searches on arrival.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- the search is the effect; its busy flag is its output.
    if (initialQuery !== "") void run();
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- once per arrival, not per keystroke.
  }, [initialQuery]);

  const words = excludedWords(exclude);
  const visible = items.filter((p) => {
    const text = p.text.toLowerCase();
    return !words.some((w) => text.includes(w));
  });
  const post = visible.find((p) => p.postId === selected);

  return (
    <>
      <PageHeader
        title="Search"
        tabs={<HeaderTabs label="Mode" tabs={MODES} value={mode} onChange={setMode} />}
        detail={searched ? `${visible.length} results` : undefined}
      />
      <form
        role="search"
        className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="flex h-8 min-w-60 flex-1 cursor-text items-center gap-2 rounded-[var(--control-radius)] border border-white/13 px-2.5 transition-[border-color] duration-150 focus-within:border-white/30">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-hidden placeholder:text-muted-foreground"
            aria-label="Search query"
            data-shortcut="search"
            placeholder="keyword from:handle min_faves:200 since:2026-10-01"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <input
          className={cn(compactInputClass, "h-8 w-44")}
          aria-label="Exclude words"
          placeholder="exclude words"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
        <button type="submit" className={xPill} disabled={busy || query.trim() === ""}>
          {busy ? "Searching" : "Search"}
          <Cost label={searchQuote} />
        </button>
      </form>
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <DetailSplit
        closable
        label="Selected post"
        detailKey={selected}
        detail={
          post === undefined ? null : (
            <PostInspector post={post} onClose={() => setSelected(null)}>
              <InspectorGroup title="Act">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SaveButton post={post} saved={saved.has(post.postId)} />
                  <RemixButton post={post} />
                </div>
              </InspectorGroup>
            </PostInspector>
          )
        }
        list={
          <>
            {!searched ? (
              <Empty>Find posts worth saving. X's own search syntax works here.</Empty>
            ) : visible.length === 0 ? (
              <Empty>
                {items.length === 0
                  ? "No results."
                  : `All ${items.length} results hold an excluded word.`}
              </Empty>
            ) : (
              <PostGrid
                items={visible.map((p) => ({ key: p.postId, post: p }))}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {searched && cursor !== null ? (
              <div className="flex justify-center pb-6">
                <button
                  type="button"
                  className={xPill}
                  disabled={busy}
                  onClick={() => void run(cursor)}
                >
                  {busy ? "Loading" : "Load more"}
                  <Cost label={searchQuote} />
                </button>
              </div>
            ) : null}
          </>
        }
      />
    </>
  );
}

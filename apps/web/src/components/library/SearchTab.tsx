import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { XPost, XSearchMode } from "@xtend/contracts";
import { Search } from "lucide-react";
import { useState } from "react";

import { observedMatching, observedToXPost } from "../../lib/observed";
import { cn } from "../../lib/utils";
import { useQuoteLabel } from "../../state/costs";
import { searchAtom } from "../../state/library";
import { recentPostsAtom } from "../../state/observations";
import { HeaderTabs, PageHeader } from "../PageHeader";
import { compactInputClass } from "../ui/field";
import { Cost, Empty } from "../ui/layout";
import { DetailSplit } from "../ui/split";
import { FreeOnX, searchUrl } from "../ui/x-link";
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
 * X search. The free way is X's own search page in the panel, whose results the
 * session observes; what it already saw for the query lists first. The paid
 * search is for volume and filters, and every run and next page shows its price;
 * a `?q=` link (the palette) only fills the box. Excluded words filter the
 * results here, after they arrive.
 */
export function SearchTab({ initialQuery }: { readonly initialQuery: string }) {
  const search = useAtomSet(searchAtom, { mode: "promise" });
  const recent = useAtomValue(recentPostsAtom);
  const saved = useSavedIds();
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState<XSearchMode>("top");
  const searchQuote = useQuoteLabel({ kind: "search", query, mode });
  const [exclude, setExclude] = useState("");
  const [items, setItems] = useState<ReadonlyArray<XPost>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the listed results answer; Load more continues it, not whatever the box says now.
  const [searched, setSearched] = useState<{
    readonly query: string;
    readonly mode: XSearchMode;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The page Load more reads is its own paid read, cached apart from the first.
  const moreQuote = useQuoteLabel(
    searched === null || cursor === null
      ? { kind: "search", query, mode }
      : { kind: "search", ...searched, cursor },
  );

  const run = async (more?: {
    readonly cursor: string;
    readonly query: string;
    readonly mode: XSearchMode;
  }) => {
    const input = more ?? { query, mode };
    // Enter submits even while the button is disabled, and every search is paid.
    if (input.query.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await search(input);
      // X can repeat a post on the next page; a second card with its key would break the grid.
      setItems((prev) =>
        more === undefined
          ? page.items
          : [...prev, ...page.items.filter((p) => !prev.some((q) => q.postId === p.postId))],
      );
      setCursor(page.nextCursor);
      setSearched({ query: input.query, mode: input.mode });
      if (more === undefined) setSelected(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const words = excludedWords(exclude);
  const visible = items.filter((p) => {
    const text = p.text.toLowerCase();
    return !words.some((w) => text.includes(w));
  });
  const seen = observedMatching(AsyncResult.getOrElse(recent, () => ({ posts: [] })).posts, query)
    .filter((p) => !items.some((q) => q.postId === p.postId))
    .map(observedToXPost)
    .filter((p) => !words.some((w) => p.text.toLowerCase().includes(w)));
  const post =
    visible.find((p) => p.postId === selected) ?? seen.find((p) => p.postId === selected);

  return (
    <>
      <PageHeader
        title="Search"
        tabs={<HeaderTabs label="Mode" tabs={MODES} value={mode} onChange={setMode} />}
        detail={searched !== null ? `${visible.length} results` : undefined}
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
        {query.trim() === "" ? null : <FreeOnX href={searchUrl(query, mode)} label="Search on X" />}
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
            {seen.length > 0 ? (
              <>
                <p className="px-6 pt-4 font-mono text-2xs text-muted-foreground">
                  seen on X · {seen.length} · free
                </p>
                <PostGrid
                  items={seen.map((p) => ({ key: p.postId, post: p }))}
                  selected={selected}
                  onSelect={setSelected}
                />
              </>
            ) : null}
            {searched === null ? (
              seen.length > 0 ? null : (
                <Empty>
                  Find posts worth saving. Search on X is free; the paid search adds volume and
                  filters.
                </Empty>
              )
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
            {searched !== null && cursor !== null ? (
              <div className="flex justify-center pb-6">
                <button
                  type="button"
                  className={xPill}
                  disabled={busy}
                  onClick={() => void run({ ...searched, cursor })}
                >
                  {busy ? "Loading" : "Load more"}
                  <Cost label={moreQuote} />
                </button>
              </div>
            ) : null}
          </>
        }
      />
    </>
  );
}

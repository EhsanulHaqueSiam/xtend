import { useAtomSet } from "@effect/atom-react";
import type { XPost, XSearchMode } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Lightbulb, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { useQuoteLabel } from "../../state/costs";
import { savePostAtom, searchAtom } from "../../state/library";
import { Button } from "../ui/button";
import { SaveButton } from "./SaveButton";
import { Empty, ErrorLine, PostRow, errorMessage, inputClass } from "./shared";

/** "Use as inspiration" saves the post so Compose can read it back by id, then opens the composer. */
export function InspireButton({ post }: { readonly post: XPost }) {
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() =>
          void save({ post, collectionId: null }).then(
            () => navigate({ href: `/compose?inspire=${post.postId}` }),
            (e: unknown) => setError(errorMessage(e)),
          )
        }
      >
        <Lightbulb /> Use as inspiration
      </Button>
      {error !== null ? <span className="text-2xs text-error-foreground">{error}</span> : null}
    </>
  );
}

const excluded = (text: string, words: ReadonlyArray<string>) => {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w));
};

/** Renders the list of search results with the exclusion filter applied client-side. */
function SearchResults({
  items,
  exclude,
}: {
  readonly items: ReadonlyArray<XPost>;
  readonly exclude: string;
}) {
  const words = exclude
    .split(/[\s,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== "");
  const visible = items.filter((p) => !excluded(p.text, words));
  if (visible.length === 0) return <Empty>No results.</Empty>;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2 py-2">
      {visible.map((post) => (
        <PostRow
          key={post.postId}
          post={post}
          actions={
            <>
              <SaveButton post={post} />
              <InspireButton post={post} />
            </>
          }
        />
      ))}
    </div>
  );
}

export function SearchTab({ initialQuery }: { readonly initialQuery: string }) {
  const search = useAtomSet(searchAtom, { mode: "promise" });
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
      const page = await search(more ?? input);
      // X can repeat a post on the next page; a second row with its key would break the list.
      setItems((prev) =>
        more === undefined
          ? page.items
          : [...prev, ...page.items.filter((p) => !prev.some((q) => q.postId === p.postId))],
      );
      setCursor(page.nextCursor);
      setSearched({ query: input.query, mode: input.mode });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // A `?q=` link (Scores sends them) searches on arrival.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- the search is the effect; its busy flag is its output.
    if (initialQuery !== "") void run();
    // eslint-disable-next-line react/exhaustive-effect-dependencies -- once per arrival, not per keystroke.
  }, [initialQuery]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex flex-col gap-2 border-b border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex gap-2">
          <input
            className={inputClass}
            aria-label="Search query"
            data-shortcut="search"
            placeholder="keyword from:handle min_faves:200 since:2026-10-01"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            <Search /> Search ({searchQuote})
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <span>X syntax works: from:handle, min_faves:200, since:YYYY-MM-DD, OR</span>
          <span className="ml-auto flex items-center gap-1">
            {(["top", "latest"] as const).map((m) => (
              <Button
                key={m}
                variant="ghost"
                size="xs"
                data-active={mode === m ? "true" : undefined}
                className="data-[active=true]:bg-accent data-[active=true]:text-foreground"
                onClick={() => setMode(m)}
              >
                {m}
              </Button>
            ))}
          </span>
          <input
            className={`${inputClass} max-w-56`}
            aria-label="Exclude words"
            placeholder="exclude words, comma separated"
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
          />
        </div>
      </form>
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {searched !== null ? (
          <>
            <SearchResults items={items} exclude={exclude} />
            {cursor !== null ? (
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run({ ...searched, cursor })}
                >
                  Load more ({moreQuote})
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <Empty>Search X for posts worth saving or stealing the structure of.</Empty>
        )}
      </div>
    </div>
  );
}

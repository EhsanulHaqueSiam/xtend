import { useAtomSet } from "@effect/atom-react";
import type { XPost, XSearchMode } from "@xtend/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Lightbulb, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { savePostAtom, searchAtom } from "../../state/library";
import { Button } from "../ui/button";
import { SaveButton } from "./SaveButton";
import {
  Empty,
  ErrorLine,
  PostRow,
  SEARCH_COST_USD,
  errorMessage,
  inputClass,
  usd,
} from "./shared";

/** "Use as inspiration" saves the post so Compose can read it back by id, then opens the composer. */
export function InspireButton({ post }: { readonly post: XPost }) {
  const save = useAtomSet(savePostAtom, { mode: "promise" });
  const navigate = useNavigate();
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() =>
        void save({ post, collectionId: null }).then(() =>
          navigate({ href: `/compose?inspire=${post.postId}` }),
        )
      }
    >
      <Lightbulb /> Use as inspiration
    </Button>
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
  const [exclude, setExclude] = useState("");
  const [items, setItems] = useState<ReadonlyArray<XPost>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = async (next?: string) => {
    if (query.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const page = await search({ query, mode, ...(next === undefined ? {} : { cursor: next }) });
      setItems((prev) => (next === undefined ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setSearched(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // A `?q=` link (Scores sends them) searches on arrival.
  useEffect(() => {
    if (initialQuery !== "") void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            placeholder="keyword from:handle min_faves:200 since:2026-10-01"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy}>
            <Search /> Search ({usd(SEARCH_COST_USD)})
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
        {searched ? (
          <>
            <SearchResults items={items} exclude={exclude} />
            {cursor !== null ? (
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(cursor)}
                >
                  Load more ({usd(SEARCH_COST_USD)})
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

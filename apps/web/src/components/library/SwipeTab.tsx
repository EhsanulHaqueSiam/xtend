import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Search } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { swipeFileAtom, swipePagesAtom } from "../../state/library";
import { PageHeader } from "../PageHeader";
import { Empty } from "../ui/layout";
import { xPill, xPillSm } from "../x";
import { SavedPosts } from "./CollectionsTab";
import { AppLink } from "./shared";

/** Every saved post with its metrics frozen at save time, searchable by text and note. `tabs` switches Saved's view. */
export function SwipeTab({ tabs }: { readonly tabs?: ReactNode }) {
  const [query, setQuery] = useState("");
  const result = useAtomValue(swipeFileAtom(query));
  const refresh = useAtomRefresh(swipeFileAtom(query));
  const refreshAll = useAtomRefresh(swipeFileAtom(""));
  const [pages, setPages] = useAtom(swipePagesAtom(query));
  const count = AsyncResult.getOrElse(
    AsyncResult.map(result, (page) => page.total.toLocaleString("en")),
    () => null,
  );
  return (
    <>
      <PageHeader
        title="Saved"
        tabs={tabs}
        detail={count === null ? undefined : `${count} saved`}
        actions={
          <label className="flex h-7 w-56 items-center gap-1.5 rounded-[var(--control-radius)] border border-white/13 px-2 transition-[border-color] duration-150 focus-within:border-white/30 @max-[44rem]:w-36">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-hidden placeholder:text-muted-foreground"
              aria-label="Search swipe file"
              placeholder="Search text and notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        }
      />
      <SavedPosts
        result={result}
        onChange={() => {
          refresh();
          refreshAll();
        }}
        onMore={() => setPages(pages + 1)}
        empty={
          query === "" ? (
            <Empty
              action={
                <AppLink href="/library?tab=picks" className={cn(xPill, xPillSm)}>
                  Open Picks
                </AppLink>
              }
            >
              Saved posts land here, from any list in Library or from X itself.
            </Empty>
          ) : (
            <Empty>No saved post mentions “{query}”.</Empty>
          )
        }
      />
    </>
  );
}

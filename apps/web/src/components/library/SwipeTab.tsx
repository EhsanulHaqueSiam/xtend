import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { swipeFileAtom } from "../../state/library";
import { SavedList } from "./CollectionsTab";
import { inputClass } from "./shared";

/** Every saved post with its metrics frozen at save time, searchable by text and note. */
export function SwipeTab() {
  const [query, setQuery] = useState("");
  const result = useAtomValue(swipeFileAtom(query));
  const refresh = useAtomRefresh(swipeFileAtom(query));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <input
          className={inputClass}
          aria-label="Search swipe file"
          placeholder="search text and notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SavedList result={result} onChange={refresh} />
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";

import { shellBridge } from "../components/shell/bridge";
import { Button } from "../components/ui/button";
import type { SessionFindResult } from "../desktopBridge";

/** ⌘F: find in x.com, X-style inline bar over the column. Esc clears the highlights and closes. */
export function FindBar() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<SessionFindResult | null>(null);
  useEffect(() => shellBridge()?.onSessionFindResult(setResult), []);

  const search = (next: string, forward: boolean, findNext: boolean) => {
    setText(next);
    shellBridge()?.sessionFind(next === "" ? null : { text: next, forward, findNext });
  };
  const close = () => {
    shellBridge()?.sessionFind(null);
    shellBridge()?.closeSlot({ kind: "bar" });
  };

  return (
    <div className="flex h-full items-center gap-1 px-4">
      <input
        autoFocus
        aria-label="Find in page"
        placeholder="Find in page"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-hidden placeholder:text-placeholder"
        value={text}
        onChange={(event) => search(event.target.value, true, false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          if (event.key === "Enter") search(text, !event.shiftKey, true);
        }}
      />
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {result === null || text === "" ? "" : `${result.activeMatchOrdinal}/${result.matches}`}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        onClick={() => search(text, false, true)}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        onClick={() => search(text, true, true)}
      >
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Close find" onClick={close}>
        <X />
      </Button>
    </div>
  );
}

export const Route = createFileRoute("/bar/find")({ component: FindBar });

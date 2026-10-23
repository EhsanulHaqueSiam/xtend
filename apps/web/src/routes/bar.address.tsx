import { useAtomValue } from "@effect/atom-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { shellBridge } from "../components/shell/bridge";
import { sessionUrlAtom } from "../state/shell";

/** "settings" or "/i/bookmarks" become x.com URLs; anything already a URL is kept. */
const toSessionUrl = (text: string): string => {
  try {
    return new URL(text.trim(), "https://x.com/").toString();
  } catch {
    return "https://x.com/home";
  }
};

/** ⌘L: one line over the top of X's column for one navigation, gone after use. */
export function AddressBar() {
  const url = useAtomValue(sessionUrlAtom);
  const [draft, setDraft] = useState<string | null>(null);
  const close = () => shellBridge()?.closeSlot({ kind: "bar" });
  return (
    <form
      className="flex h-full items-center px-4"
      onSubmit={(event) => {
        event.preventDefault();
        shellBridge()?.navigateSession(toSessionUrl(draft ?? url));
        close();
      }}
    >
      <input
        autoFocus
        aria-label="Session URL"
        spellCheck={false}
        className="w-full bg-transparent text-[15px] text-foreground outline-hidden placeholder:text-placeholder"
        placeholder="x.com/…"
        value={draft ?? url}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      />
    </form>
  );
}

export const Route = createFileRoute("/bar/address")({ component: AddressBar });

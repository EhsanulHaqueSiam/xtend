import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { DesktopBridge, SessionDownload, SessionFindResult } from "../../desktopBridge";
import { Button } from "../ui/button";

const TOAST_MS = 4_000;

const inputClass =
  "h-6 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground outline-hidden placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring";

/** "settings" or "/i/bookmarks" become x.com URLs; anything already a URL is kept. */
const toSessionUrl = (text: string): string => {
  try {
    return new URL(text.trim(), "https://x.com/").toString();
  } catch {
    return "https://x.com/home";
  }
};

/**
 * Browser chrome for the native x.com view, drawn by the app above it:
 * back, forward, reload, the current URL, find (⌘F) and download toasts.
 * It lives above the view, so opening the find row shrinks the view.
 */
export function SessionBar({ bridge }: { readonly bridge: DesktopBridge }) {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const [findResult, setFindResult] = useState<SessionFindResult | null>(null);
  const [toast, setToast] = useState<SessionDownload | null>(null);
  const findInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    const offs = [
      bridge.onSessionUrl(setUrl),
      bridge.onSessionFindResult(setFindResult),
      bridge.onSessionDownload((download) => {
        setToast(download);
        clearTimeout(toastTimer);
        if (download.state !== "started") toastTimer = setTimeout(() => setToast(null), TOAST_MS);
      }),
      bridge.onShortcut((key) => {
        if (key !== "find") return;
        setFind((current) => current ?? "");
        setTimeout(() => findInput.current?.select(), 0);
      }),
    ];
    return () => {
      clearTimeout(toastTimer);
      for (const off of offs) off();
    };
  }, [bridge]);

  const closeFind = () => {
    setFind(null);
    setFindResult(null);
    bridge.sessionFind(null);
  };
  const search = (text: string, forward: boolean, findNext: boolean) => {
    setFind(text);
    bridge.sessionFind(text === "" ? null : { text, forward, findNext });
  };
  const submitUrl = (event: FormEvent) => {
    event.preventDefault();
    if (draft !== null) bridge.navigateSession(toSessionUrl(draft));
    setDraft(null);
  };

  return (
    <div className="shrink-0 border-b border-border text-xs">
      <form onSubmit={submitUrl} className="flex h-8 items-center gap-1 px-2">
        <Button variant="ghost" size="icon-xs" aria-label="Back" onClick={bridge.sessionBack}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Forward" onClick={bridge.sessionForward}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Reload" onClick={bridge.sessionReload}>
          <RotateCw />
        </Button>
        <input
          aria-label="Session URL"
          className={inputClass}
          value={draft ?? url}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          spellCheck={false}
        />
        {toast !== null ? (
          <span
            className={toast.state === "failed" ? "text-error-foreground" : "text-muted-foreground"}
          >
            {toast.state === "started"
              ? `Downloading ${toast.name}`
              : toast.state === "completed"
                ? `Saved ${toast.name} to Downloads`
                : `Download failed: ${toast.name}`}
          </span>
        ) : null}
      </form>
      {find !== null ? (
        <div className="flex h-8 items-center gap-1 border-t border-border px-2">
          <input
            ref={findInput}
            aria-label="Find in page"
            className={inputClass}
            placeholder="Find in page"
            autoFocus
            value={find}
            onChange={(e) => search(e.target.value, true, false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeFind();
              if (e.key === "Enter") search(find, !e.shiftKey, true);
            }}
          />
          <span className="font-mono text-muted-foreground">
            {findResult === null || find === ""
              ? ""
              : `${findResult.activeMatchOrdinal}/${findResult.matches}`}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous match"
            onClick={() => search(find, false, true)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next match"
            onClick={() => search(find, true, true)}
          >
            <ChevronDown />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Close find" onClick={closeFind}>
            <X />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

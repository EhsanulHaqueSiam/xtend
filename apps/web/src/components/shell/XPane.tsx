import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Maximize2,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  clampXPanelWidth,
  markXReady,
  registerXWebview,
  xBack,
  xFind,
  xFindOpenAtom,
  xForward,
  xPanelOpenAtom,
  xPanelWidthAtom,
  xReload,
  xUnreadAtom,
  xUrlAtom,
  type XWebview,
} from "../../state/x";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Where the pane sits: over the main area on X's own pages, docked right beside a tool, or parked. */
export type XPaneMode = "main" | "panel" | "hidden";

const stringField = (event: Event, field: "url" | "title"): string | null => {
  const value: unknown = Reflect.get(event, field);
  return typeof value === "string" ? value : null;
};

/**
 * Creates the `<webview>` once and keeps it. It is built by hand rather than by
 * React so its partition is set before its first navigation, and so no render
 * ever recreates it: moving it in the DOM would reload x.com.
 */
function useXWebview(container: HTMLDivElement | null) {
  const setUrl = useAtomSet(xUrlAtom);
  const setUnread = useAtomSet(xUnreadAtom);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (container === null || bridge === undefined) return;
    const el = document.createElement("webview") as XWebview;
    // Main forces the partition and preload anyway; asking for the right ones keeps the attach from being refused.
    el.setAttribute("partition", bridge.xPartition);
    el.setAttribute("allowpopups", "");
    el.setAttribute("src", bridge.xStartUrl);
    el.className = "absolute inset-0 size-full bg-black";
    const onUrl = (event: Event) => {
      const url = stringField(event, "url");
      if (url !== null && Reflect.get(event, "isMainFrame") !== false) setUrl(url);
    };
    const onTitle = (event: Event) => {
      const count = /^\((\d+)\)/.exec(stringField(event, "title") ?? "")?.[1];
      setUnread(count === undefined ? 0 : Number(count));
    };
    el.addEventListener("dom-ready", markXReady);
    el.addEventListener("did-navigate", onUrl);
    el.addEventListener("did-navigate-in-page", onUrl);
    el.addEventListener("page-title-updated", onTitle);
    registerXWebview(el);
    setUrl(bridge.xStartUrl);
    container.append(el);
    return () => {
      registerXWebview(null);
      el.remove();
    };
  }, [container, setUnread, setUrl]);
}

/** ⌘F over x.com: Enter for next, Shift+Enter for previous, Esc clears and closes. */
function FindBar({ container }: { readonly container: HTMLDivElement | null }) {
  const [open, setOpen] = useAtom(xFindOpenAtom);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ active: number; matches: number } | null>(null);
  useEffect(() => {
    const el = container?.querySelector("webview");
    if (el === null || el === undefined) return;
    const onFound = (event: Event) => {
      const r: unknown = Reflect.get(event, "result");
      if (typeof r !== "object" || r === null) return;
      const active = Reflect.get(r, "activeMatchOrdinal");
      const matches = Reflect.get(r, "matches");
      if (typeof active === "number" && typeof matches === "number") setResult({ active, matches });
    };
    el.addEventListener("found-in-page", onFound);
    return () => el.removeEventListener("found-in-page", onFound);
  }, [container]);
  if (!open) return null;
  const search = (next: string, forward: boolean, findNext: boolean) => {
    setText(next);
    xFind(next === "" ? null : { text: next, forward, findNext });
  };
  const close = () => {
    xFind(null);
    setText("");
    setResult(null);
    setOpen(false);
  };
  return (
    <div className="absolute top-3 right-3 z-10 flex h-9 w-80 items-center gap-1 rounded-[var(--radius)] border border-white/13 bg-surface-raised pr-1 pl-3">
      <input
        autoFocus
        aria-label="Find in x.com"
        placeholder="Find in page"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-hidden placeholder:text-placeholder"
        value={text}
        onChange={(event) => search(event.target.value, true, false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          if (event.key === "Enter") search(text, !event.shiftKey, true);
        }}
      />
      <span className="font-mono text-2xs text-muted-foreground tabular-nums">
        {result === null || text === "" ? "" : `${result.active}/${result.matches}`}
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

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `x.com${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return "x.com";
  }
};

/** An icon button with its name in a tooltip; after the first, neighbours open at once. */
function BarButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** The docked panel's bar: where x.com is, history, open it big, open it in the browser, close. */
function PanelBar() {
  const url = useAtomValue(xUrlAtom);
  const setOpen = useAtomSet(xPanelOpenAtom);
  const navigate = useNavigate();
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {pathOf(url)}
      </span>
      <BarButton label="Back" onClick={xBack}>
        <ArrowLeft />
      </BarButton>
      <BarButton label="Forward" onClick={xForward}>
        <ArrowRight />
      </BarButton>
      <BarButton label="Reload" onClick={xReload}>
        <RotateCw />
      </BarButton>
      <BarButton label="Open X full size" onClick={() => void navigate({ to: "/x" })}>
        <Maximize2 />
      </BarButton>
      <BarButton label="Open in browser" onClick={() => window.desktopBridge?.openExternal(url)}>
        <ExternalLink />
      </BarButton>
      <BarButton label="Close X panel" onClick={() => setOpen(false)}>
        <X />
      </BarButton>
    </div>
  );
}

/**
 * Drag handle on the panel's left edge. While dragging, a sheet covers the
 * window: the webview is its own process and would swallow the pointer otherwise.
 */
function ResizeHandle() {
  const setWidth = useAtomSet(xPanelWidthAtom);
  const [dragging, setDragging] = useState(false);
  const onDown = (event: ReactPointerEvent) => {
    event.preventDefault();
    setDragging(true);
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) =>
      setWidth(clampXPanelWidth(window.innerWidth - event.clientX));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setWidth]);
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize X panel"
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize"
        onPointerDown={onDown}
      />
      {dragging ? <div className="fixed inset-0 z-50 cursor-col-resize" /> : null}
    </>
  );
}

/**
 * x.com inside Xtend: the user's own logged-in session, so browsing it costs
 * nothing and X sees an ordinary Chromium tab. One webview for the window's
 * life; the pane moves it with CSS between the main area and the side panel.
 */
export function XPane({
  mode,
  width,
  inset = 0,
}: {
  readonly mode: XPaneMode;
  readonly width: number;
  /** Room left on the right in main mode, for Home's companion column. */
  readonly inset?: number;
}) {
  // The webview's own box: React renders nothing into it, so it never touches the element.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useXWebview(host);
  return (
    <section
      aria-label="x.com"
      data-mode={mode}
      className={cn(
        "row-start-1 flex min-w-0 flex-col bg-black",
        mode === "main" && "z-10 col-start-2",
        mode === "panel" && "relative col-start-3 border-l border-border",
        mode === "hidden" && "invisible fixed top-0 -left-[10000px] h-full",
      )}
      style={mode === "hidden" ? { width } : mode === "main" ? { marginRight: inset } : undefined}
    >
      {mode === "panel" ? (
        <>
          <ResizeHandle />
          <PanelBar />
        </>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={setHost} className="absolute inset-0" />
        <FindBar container={host} />
      </div>
    </section>
  );
}

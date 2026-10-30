import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import {
  isXRoute,
  rememberToolRoute,
  xPanelOpenAtom,
  xPanelWidthAtom,
  xSkinAtom,
} from "../../state/x";
import { Toasts } from "../ui/toast";
import { CommandPalette } from "./CommandPalette";
import { CompanionTarget } from "./Companion";
import { GlanceSync } from "./GlanceSync";
import { Sidebar } from "./Sidebar";
import { XPane, type XPaneMode } from "./XPane";

/** Below this the main area keeps companion cards under the page instead of in a column. */
const COMPANION_MIN_MAIN = 980;
const COMPANION_WIDTH = 340;

function useWidth(el: HTMLElement | null) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

/**
 * Routes asked for from outside the page: a deep link, or one of the x.com
 * injections (Reply with AI, Schedule, Full report). Those come from X, so X
 * stays in view beside the screen they open.
 */
function AppRoutes({ main }: { readonly main: HTMLElement }) {
  const navigate = useNavigate();
  const setPanel = useAtomSet(xPanelOpenAtom);
  const skin = useAtomValue(xSkinAtom);
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge === undefined) return;
    const open = (route: string) => {
      setPanel(true);
      void navigate({ href: route }).then(() => main.focus());
    };
    if (bridge.initialRoute !== null) open(bridge.initialRoute);
    return bridge.onAppRoute(open);
  }, [main, navigate, setPanel]);
  useEffect(() => {
    window.desktopBridge?.setXSkin(skin);
  }, [skin]);
  return null;
}

/**
 * The app's frame, on the desktop and in a browser: the sidebar, the main area
 * and, on the desktop, x.com. X's own pages put x.com in the main area; tool
 * screens put it in a panel on the right (⌘\), or park it out of sight with the
 * session and scroll intact.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const href = useLocation({ select: (l) => l.href });
  const pathname = useLocation({ select: (l) => l.pathname });
  const panelOpen = useAtomValue(xPanelOpenAtom);
  const panelWidth = useAtomValue(xPanelWidthAtom);
  const [main, setMain] = useState<HTMLElement | null>(null);
  const [companion, setCompanion] = useState<HTMLElement | null>(null);
  const wide = useWidth(main) >= COMPANION_MIN_MAIN;

  const onX = isXRoute(pathname);
  useEffect(() => {
    if (!onX) rememberToolRoute(href);
  }, [href, onX]);
  const mode: XPaneMode = onX ? "main" : panelOpen ? "panel" : "hidden";
  // On Home the companion column takes X's hidden right column, so the pane leaves it room.
  const companionWidth = onX && wide ? COMPANION_WIDTH : 0;
  const columns = `auto minmax(0, 1fr) ${isElectron && mode === "panel" ? `${panelWidth}px` : "0px"}`;

  return (
    <div className="grid h-full w-full bg-background" style={{ gridTemplateColumns: columns }}>
      <Sidebar />
      <main tabIndex={-1} ref={setMain} className="col-start-2 row-start-1 flex min-h-0 min-w-0">
        <CompanionTarget value={wide ? companion : null}>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
        </CompanionTarget>
        <aside
          ref={setCompanion}
          aria-label="Companion"
          className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-4 empty:hidden"
        />
      </main>
      {isElectron ? (
        <>
          <XPane mode={mode} width={panelWidth} inset={companionWidth} />
          {main === null ? null : <AppRoutes main={main} />}
          <GlanceSync />
        </>
      ) : null}
      <CommandPalette />
      <Toasts />
    </div>
  );
}

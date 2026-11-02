import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import type { ShortcutKey } from "../../desktopBridge";
import { isElectron } from "../../env";
import { paletteOpenAtom } from "../../state/shell";
import {
  isXRoute,
  lastToolRoute,
  refreshScreen,
  xFindOpenAtom,
  xPanelOpenAtom,
} from "../../state/x";
import { SCREENS } from "./commands";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The app's keys. ⌘K toggles the palette, ⌘\ docks or hides x.com beside a
 * tool, ⌘F finds in x.com, ⌘R or F5 (from main) refresh the open screen,
 * and single letters outside text fields open screens. While x.com has focus
 * its own keys stay X's; main forwards the chords so they work there too.
 */
/**
 * ⌘[ and ⌘] (Alt+← and Alt+→ off macOS) on the desktop, as a browser's own; text fields keep
 * them, so a draft is never lost to a stray ⌘[.
 */
const historyStep = (event: KeyboardEvent): "back" | "forward" | null => {
  const mac = window.desktopBridge?.platform === "darwin";
  const plain =
    !event.shiftKey && (mac ? event.metaKey && !event.altKey : event.altKey && !event.ctrlKey);
  if (!plain) return null;
  if (event.key === (mac ? "[" : "ArrowLeft")) return "back";
  if (event.key === (mac ? "]" : "ArrowRight")) return "forward";
  return null;
};

export function ShellHotkeys() {
  const navigate = useNavigate();
  const { history } = useRouter();
  const pathname = useLocation({ select: (l) => l.pathname });
  const searchStr = useLocation({ select: (l) => l.searchStr });
  const setPalette = useAtomSet(paletteOpenAtom);
  const setFind = useAtomSet(xFindOpenAtom);
  const panelOpen = useAtomValue(xPanelOpenAtom);
  const setPanel = useAtomSet(xPanelOpenAtom);

  // oxlint-disable-next-line xtend/no-unreasoned-state-sync -- subscribes to the desktop bridge's shortcut chords while mounted.
  useEffect(() => {
    const onX = isXRoute(pathname);
    const chord = (key: ShortcutKey) => {
      if (key === "palette") return setPalette((open) => !open);
      if (key === "refresh") return refreshScreen();
      if (key === "back") return history.back();
      if (key === "forward") return history.forward();
      if (!isElectron) return;
      if (key === "find") return onX || panelOpen ? setFind(true) : undefined;
      // From X's own pages, ⌘\ goes back to the last tool with x.com beside it.
      if (onX) {
        setPanel(true);
        return void navigate({ href: lastToolRoute() });
      }
      setPanel(!panelOpen);
    };
    const letter = (key: string) => {
      if (key === "x" && isElectron) return void navigate({ to: "/x" });
      if (key === "c") return void navigate({ href: "/compose?new=1" });
      if (key === "s") {
        const focus = () =>
          document.querySelector<HTMLElement>('[data-shortcut="search"]')?.focus();
        if (pathname === "/library" && new URLSearchParams(searchStr).get("tab") === "search")
          focus();
        else void navigate({ href: "/library?tab=search" }).then(focus);
        return;
      }
      const screen = SCREENS.find((s) => s.key === key)?.to;
      if (screen !== undefined) void navigate({ to: screen });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey) {
        const map: Record<string, ShortcutKey> = { k: "palette", "\\": "xPanel", f: "find" };
        const hit = map[key];
        if (hit !== undefined) {
          event.preventDefault();
          return chord(hit);
        }
      }
      const step = isElectron && !isEditable(event.target) ? historyStep(event) : null;
      if (step !== null) {
        event.preventDefault();
        return chord(step);
      }
      if (mod || event.altKey || isEditable(event.target)) return;
      if (key.length === 1 && /[a-z]/.test(key)) letter(key);
    };
    // Mouse buttons 4 and 5; Chromium in Electron does not navigate on them by itself.
    const onMouseUp = (event: MouseEvent) => {
      if (!isElectron || (event.button !== 3 && event.button !== 4)) return;
      event.preventDefault();
      chord(event.button === 3 ? "back" : "forward");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    const offBridge = window.desktopBridge?.onShortcut(chord);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
      offBridge?.();
    };
  }, [history, navigate, panelOpen, pathname, searchStr, setFind, setPalette, setPanel]);

  return null;
}

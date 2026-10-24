import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import type { ShortcutKey } from "../../desktopBridge";
import { isElectron } from "../../env";
import { paletteOpenAtom } from "../../state/shell";
import { isXRoute, lastToolRoute, xFindOpenAtom, xPanelOpenAtom } from "../../state/x";
import { SCREENS } from "./commands";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The app's keys. ⌘K toggles the palette, ⌘\ docks or hides x.com beside a
 * tool, ⌘F finds in x.com, and single letters outside text fields open
 * screens. While x.com has focus its own keys stay X's; main forwards the
 * three chords so they work there too.
 */
export function ShellHotkeys() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const setPalette = useAtomSet(paletteOpenAtom);
  const setFind = useAtomSet(xFindOpenAtom);
  const panelOpen = useAtomValue(xPanelOpenAtom);
  const setPanel = useAtomSet(xPanelOpenAtom);

  useEffect(() => {
    const onX = isXRoute(pathname);
    const chord = (key: ShortcutKey) => {
      if (key === "palette") return setPalette((open) => !open);
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
      if (key === "s") {
        void navigate({ href: "/library" });
        // The search input mounts with the route; focus it once it exists.
        setTimeout(
          () => document.querySelector<HTMLElement>('[data-shortcut="search"]')?.focus(),
          50,
        );
        return;
      }
      if (key === "r") return void navigate({ href: "/compose?reply=1" });
      const screen = SCREENS.find((s) => s.key === key)?.to;
      if (screen !== undefined) void navigate({ to: screen });
    };
    const onKeyDown = (event: KeyboardEvent) => {
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
      if (mod || event.altKey || isEditable(event.target)) return;
      if (key.length === 1 && /[a-z]/.test(key)) letter(key);
    };
    window.addEventListener("keydown", onKeyDown);
    const offBridge = window.desktopBridge?.onShortcut(chord);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      offBridge?.();
    };
  }, [navigate, panelOpen, pathname, setFind, setPalette, setPanel]);

  return null;
}

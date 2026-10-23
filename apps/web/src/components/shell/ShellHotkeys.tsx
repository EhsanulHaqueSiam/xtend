import { useAtom, useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { paletteOpenAtom, slotAtom } from "../../state/shell";
import { shellBridge } from "./bridge";
import { SCREENS } from "./commands";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Single-key navigation, ⌘K and Esc in the app's own view. Standalone they
 * navigate and toggle the overlay palette; in a slot they ask main for the
 * matching slot, and Esc hides the one that is open.
 */
export function ShellHotkeys() {
  const navigate = useNavigate();
  const [, setPalette] = useAtom(paletteOpenAtom);
  const slot = useAtomValue(slotAtom);

  useEffect(() => {
    const bridge = shellBridge();
    const go = (href: string) =>
      bridge === undefined
        ? void navigate({ href })
        : bridge.openSlot({ kind: "center", route: href });
    const palette = () => {
      if (bridge === undefined) return setPalette((open) => !open);
      if (slot.kind === "palette") bridge.closeSlot({ kind: "palette" });
      else bridge.openSlot({ kind: "palette", route: "/palette" });
    };
    const run = (key: string) => {
      if (key === "s") {
        go("/library");
        // The search input mounts with the route; focus it once it exists.
        setTimeout(
          () => document.querySelector<HTMLElement>('[data-shortcut="search"]')?.focus(),
          50,
        );
        return;
      }
      if (key === "r") return go("/compose?reply=1");
      const screen = SCREENS.find((s) => s.key === key)?.to;
      if (screen !== undefined) go(screen);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        return palette();
      }
      // A menu or dialog that took Esc already prevented it; otherwise Esc hides the slot.
      if (event.key === "Escape" && bridge !== undefined && !event.defaultPrevented)
        return bridge.closeSlot();
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (key.length === 1 && /[a-z]/.test(key)) run(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, setPalette, slot.kind]);

  return null;
}

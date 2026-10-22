import { useAtom } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { paletteOpenAtom } from "../../state/shell";
import { shellBridge } from "./bridge";
import { BRIDGE_SCREENS, SCREENS } from "./commands";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Single-key navigation and ⌘K, from the browser when nothing is focused and
 * from the desktop bridge when x.com or the app window had the key.
 */
export function ShellHotkeys() {
  const navigate = useNavigate();
  const [, setPalette] = useAtom(paletteOpenAtom);

  useEffect(() => {
    const go = (href: string) => void navigate({ href });
    const run = (key: string) => {
      if (key === "palette") return setPalette((open) => !open);
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
      const screen = BRIDGE_SCREENS[key] ?? SCREENS.find((s) => s.key === key)?.to;
      if (screen !== undefined) go(screen);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        return run("palette");
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (key.length === 1 && /[a-z]/.test(key)) run(key);
    };
    window.addEventListener("keydown", onKeyDown);
    const unsubscribe = shellBridge()?.onShortcut?.(run);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe?.();
    };
  }, [navigate, setPalette]);

  return null;
}

import { useEffect, useRef } from "react";

import { SessionBar } from "./session/SessionBar";

/**
 * Reserves the area where Electron paints the x.com WebContentsView and keeps
 * the main process told of its bounds. Nothing is rendered inside: the native
 * view sits above the renderer. The session bar sits above the slot, so
 * whatever it shows (find row, toast) shrinks the view. Routes the desktop
 * asks for are handled at the root, so they work from any screen.
 */
export function SessionViewSlot() {
  const ref = useRef<HTMLDivElement>(null);
  const bridge = window.desktopBridge;

  useEffect(() => {
    const element = ref.current;
    if (bridge === undefined || element === null) return;
    const report = () => {
      const rect = element.getBoundingClientRect();
      bridge.setSessionViewBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      bridge.setSessionViewBounds(null);
    };
  }, [bridge]);

  return (
    <div className="flex h-full w-full flex-col">
      {bridge !== undefined ? <SessionBar bridge={bridge} /> : null}
      <div ref={ref} className="min-h-0 flex-1" />
    </div>
  );
}

import { useEffect, useRef } from "react";

/**
 * Reserves the area where Electron paints the x.com WebContentsView and keeps
 * the main process told of its bounds. Nothing is rendered inside: the native
 * view sits above the renderer.
 */
export function SessionViewSlot() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = window.desktopBridge;
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
  }, []);

  return <div ref={ref} className="h-full w-full" />;
}

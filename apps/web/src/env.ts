import type { DesktopBridge } from "./desktopBridge";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

/** The preload sets window.desktopBridge before any app code runs, so this is reliable at module load. */
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

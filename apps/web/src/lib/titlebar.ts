import { isElectron } from "../env";

/** Height of the native title bar overlay the desktop draws; popovers keep clear of it. */
const MACOS_TITLEBAR_HEIGHT = 38;

export function useNativeTitlebarHeight(): number {
  return isElectron && window.desktopBridge?.platform === "darwin" ? MACOS_TITLEBAR_HEIGHT : 0;
}

import type { DesktopBridge } from "../../desktopBridge";

/**
 * The round 2 bridge methods the shell uses (ROUND2.md contract 1). Optional
 * until apps/web/src/desktopBridge.ts (desktop-owned) declares them.
 * shortcut: cast instead of a shared type, drop once DesktopBridge has these.
 */
interface ShellBridge extends DesktopBridge {
  readonly navigateSession?: (url: string) => void;
  readonly setSessionViewHidden?: (hidden: boolean) => void;
  readonly openExternal?: (url: string) => void;
  readonly onShortcut?: (cb: (key: string) => void) => () => void;
}

export const shellBridge = (): ShellBridge | undefined => window.desktopBridge;

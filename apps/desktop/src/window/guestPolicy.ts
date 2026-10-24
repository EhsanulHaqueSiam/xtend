import type { ShortcutKey } from "../ipc/channels.ts";

/**
 * The rules for the x.com webview, kept free of Electron so they can be tested:
 * which hosts it may show, which partition and preload it must run with, which
 * URLs may leave the app, and which keys main takes from it.
 */

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
export const X_HOME = "https://x.com/home";
/** Sign-in providers x.com opens in a popup; they share the session partition so the cookie lands in it. */
export const OAUTH_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);

/** Account 1 keeps the partition name from before multi-account, so an existing login survives the upgrade. */
export const sessionPartition = (accountId: number) =>
  accountId === 1 ? "persist:x-session" : `persist:x-session-${accountId}`;

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
export const isXHost = (url: string) => X_HOSTS.has(hostOf(url));

/** Only web URLs leave the app; a page must not be able to launch file: or custom-scheme handlers. */
export const externalWebUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

/** Chromium's UA minus the Electron and app tokens, so x.com sees the browser it would see in Chromium. */
export const browserUserAgent = (ua: string) =>
  ua
    .replace(/ Electron\/\S+/, "")
    .replace(/ xtend\/\S+/i, "")
    .replace(/ @xtend\/\S+/i, "");

interface GuestPreferences {
  preload?: string | undefined;
  nodeIntegration?: boolean | undefined;
  nodeIntegrationInSubFrames?: boolean | undefined;
  contextIsolation?: boolean | undefined;
  sandbox?: boolean | undefined;
  webSecurity?: boolean | undefined;
}

/**
 * Gate for `will-attach-webview`. The app page asks for a webview, but main
 * decides what it becomes: only x.com, only on the current account's
 * partition, only with the overlay preload in an isolated, sandboxed world.
 * Returns false when the attach must be refused; mutates the inputs otherwise.
 */
export function hardenXWebview(
  webPreferences: GuestPreferences,
  params: Record<string, string>,
  required: { readonly partition: string; readonly preload: string },
): boolean {
  if (!isXHost(params.src ?? "") || params.partition !== required.partition) return false;
  webPreferences.preload = required.preload;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  return true;
}

/** The subset of Electron's `Input` the key rules read. */
export interface KeyInput {
  readonly type: string;
  readonly code: string;
  readonly key: string;
  readonly meta: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat: boolean;
}

export type GuestKey =
  | { readonly kind: "app"; readonly key: ShortcutKey }
  | { readonly kind: "overlayToggle" }
  | { readonly kind: "zoom"; readonly step: -1 | 0 | 1 }
  | { readonly kind: "history"; readonly direction: "back" | "forward" };

/**
 * What a key press in x.com means to Xtend. Only chorded keys: X's own single-letter
 * shortcuts (j, k, l, r, n) keep working while the user browses.
 */
export function guestKey(input: KeyInput, platform: NodeJS.Platform): GuestKey | null {
  if (input.type !== "keyDown" || input.isAutoRepeat) return null;
  const mod = platform === "darwin" ? input.meta : input.control;
  if (input.alt && !mod && !input.shift && input.code === "KeyO") return { kind: "overlayToggle" };
  if (!mod || input.alt) return null;
  if (!input.shift) {
    if (input.code === "KeyK") return { kind: "app", key: "palette" };
    if (input.code === "Backslash") return { kind: "app", key: "xPanel" };
    if (input.code === "KeyF") return { kind: "app", key: "find" };
    if (input.key === "[") return { kind: "history", direction: "back" };
    if (input.key === "]") return { kind: "history", direction: "forward" };
    if (input.key === "0") return { kind: "zoom", step: 0 };
    if (input.key === "-") return { kind: "zoom", step: -1 };
  }
  if (input.key === "=" || input.key === "+") return { kind: "zoom", step: 1 };
  return null;
}

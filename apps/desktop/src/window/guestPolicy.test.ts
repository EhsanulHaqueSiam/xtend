import { describe, expect, it } from "vite-plus/test";

import {
  browserUserAgent,
  externalWebUrl,
  guestKey,
  hardenXWebview,
  type KeyInput,
} from "./guestPolicy.ts";

const required = { partition: "persist:x-session", preload: "/app/overlayPreload.cjs" };

describe("hardenXWebview", () => {
  it("forces the overlay preload into a sandboxed, isolated x.com guest", () => {
    const prefs: Parameters<typeof hardenXWebview>[0] = {
      preload: "/tmp/evil.js",
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    };
    const ok = hardenXWebview(
      prefs,
      { src: "https://x.com/home", partition: "persist:x-session" },
      required,
    );
    expect(ok).toBe(true);
    expect(prefs).toEqual({
      preload: "/app/overlayPreload.cjs",
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it("refuses other hosts and other accounts' partitions", () => {
    expect(
      hardenXWebview({}, { src: "https://example.com/", partition: "persist:x-session" }, required),
    ).toBe(false);
    expect(
      hardenXWebview({}, { src: "https://x.com/home", partition: "persist:x-session-2" }, required),
    ).toBe(false);
    expect(hardenXWebview({}, { partition: "persist:x-session" }, required)).toBe(false);
  });
});

const key = (over: Partial<KeyInput>): KeyInput => ({
  type: "keyDown",
  code: "",
  key: "",
  meta: false,
  control: false,
  alt: false,
  shift: false,
  isAutoRepeat: false,
  ...over,
});

describe("guestKey", () => {
  it("takes the app's chords with the platform's modifier", () => {
    expect(guestKey(key({ code: "KeyK", meta: true }), "darwin")).toEqual({
      kind: "app",
      key: "palette",
    });
    expect(guestKey(key({ code: "KeyK", control: true }), "linux")).toEqual({
      kind: "app",
      key: "palette",
    });
    expect(guestKey(key({ code: "KeyK", control: true }), "darwin")).toBeNull();
    expect(guestKey(key({ code: "Backslash", control: true }), "linux")).toEqual({
      kind: "app",
      key: "xPanel",
    });
    expect(guestKey(key({ code: "KeyF", control: true }), "linux")).toEqual({
      kind: "app",
      key: "find",
    });
  });

  it("takes ⌘R and F5 as the app's refresh, and leaves ⇧⌘R to reload the app", () => {
    const refresh = { kind: "app", key: "refresh" };
    expect(guestKey(key({ code: "KeyR", meta: true }), "darwin")).toEqual(refresh);
    expect(guestKey(key({ code: "KeyR", control: true }), "linux")).toEqual(refresh);
    expect(guestKey(key({ code: "F5", key: "F5" }), "linux")).toEqual(refresh);
    expect(guestKey(key({ code: "KeyR", meta: true, shift: true }), "darwin")).toBeNull();
  });

  it("leaves X's own single-letter shortcuts alone", () => {
    for (const code of ["KeyJ", "KeyK", "KeyL", "KeyC", "KeyP"])
      expect(guestKey(key({ code }), "linux")).toBeNull();
  });

  it("maps history, zoom and the overlay toggle", () => {
    expect(guestKey(key({ key: "[", control: true }), "linux")).toEqual({
      kind: "history",
      direction: "back",
    });
    expect(guestKey(key({ key: "+", control: true, shift: true }), "linux")).toEqual({
      kind: "zoom",
      step: 1,
    });
    expect(guestKey(key({ code: "KeyO", alt: true }), "linux")).toEqual({ kind: "overlayToggle" });
    expect(guestKey(key({ code: "KeyK", control: true, isAutoRepeat: true }), "linux")).toBeNull();
  });
});

describe("browser identity and exits", () => {
  it("strips the Electron and app tokens from the user agent", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) xtend/0.0.2 Chrome/146.0.0.0 Electron/41.0.0 Safari/537.36";
    expect(browserUserAgent(ua)).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    );
  });

  it("lets only web URLs leave the app", () => {
    expect(externalWebUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(externalWebUrl("file:///etc/passwd")).toBeNull();
    expect(externalWebUrl("vscode://open")).toBeNull();
  });
});

import { describe, expect, it } from "vite-plus/test";

import { assetsOf, detect, isRelease, withArch } from "./release.ts";

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/EhsanulHaqueSiam/xtend/releases/download/v0.0.4/${name}`,
});

// v0.0.4 as published: no Windows or Linux arm64 build yet, and zips beside the dmgs.
const v004 = {
  tag_name: "v0.0.4",
  html_url: "https://github.com/EhsanulHaqueSiam/xtend/releases/tag/v0.0.4",
  prerelease: false,
  assets: [
    "latest-mac.yml",
    "Xtend-0.0.4-arm64-mac.zip",
    "Xtend-0.0.4-arm64.dmg",
    "Xtend-0.0.4-arm64.dmg.blockmap",
    "Xtend-0.0.4-mac.zip",
    "Xtend-0.0.4-x86_64.AppImage",
    "Xtend-0.0.4.dmg",
    "xtend-cli-0.0.4.tgz",
  ].map(asset),
};

describe("detect", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", "MacIntel", "mac-arm64"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140", "Win32", "win-x64"],
    ["Mozilla/5.0 (X11; Linux aarch64) Firefox/140", "Linux aarch64", "linux-arm64"],
    ["Mozilla/5.0 (X11; Linux x86_64) Chrome/140", "Linux x86_64", "linux-x64"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140", "Linux armv8l", "mac-arm64"],
  ] as const)("%s", (userAgent, platform, target) => {
    expect(detect(userAgent, platform)).toBe(target);
  });

  it("takes the chip the browser reports", () => {
    expect(withArch("mac-arm64", "x86")).toBe("mac-x64");
    expect(withArch("win-x64", "arm")).toBe("win-arm64");
  });
});

describe("assetsOf", () => {
  it("matches each target to its file and leaves missing ones out", () => {
    const names = Object.fromEntries(
      Object.entries(assetsOf(v004)).map(([target, a]) => [target, a.name]),
    );
    expect(names).toEqual({
      "mac-arm64": "Xtend-0.0.4-arm64.dmg",
      "mac-x64": "Xtend-0.0.4.dmg",
      "linux-x64": "Xtend-0.0.4-x86_64.AppImage",
      cli: "xtend-cli-0.0.4.tgz",
    });
  });

  it("finds a nightly's Intel dmg by the same rule", () => {
    const nightly = { ...v004, assets: [asset("Xtend-0.0.5-nightly.20261103.66.dmg")] };
    expect(assetsOf(nightly)["mac-x64"]?.name).toBe("Xtend-0.0.5-nightly.20261103.66.dmg");
  });
});

describe("isRelease", () => {
  it("rejects a release whose links leave GitHub", () => {
    expect(isRelease(v004)).toBe(true);
    const bad = {
      ...v004,
      assets: [{ name: "Xtend-1-arm64.dmg", browser_download_url: "https://evil.example/x" }],
    };
    expect(isRelease(bad)).toBe(false);
    expect(isRelease({ message: "API rate limit exceeded" })).toBe(false);
  });
});

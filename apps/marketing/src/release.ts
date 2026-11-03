export const RELEASES = "https://github.com/EhsanulHaqueSiam/xtend/releases";
const API = "https://api.github.com/repos/EhsanulHaqueSiam/xtend/releases";

/** Each download target and the asset name the release workflow gives it. */
export const TARGETS = {
  "mac-arm64": { os: "macOS", chip: "Apple silicon", file: /^Xtend-.+-arm64\.dmg$/ },
  // electron-builder leaves the arch out of the Intel dmg's name.
  "mac-x64": { os: "macOS", chip: "Intel", file: /^Xtend-(?!.*-arm64).+\.dmg$/ },
  "win-x64": { os: "Windows", chip: "x64", file: /^Xtend-.+-x64\.exe$/ },
  "win-arm64": { os: "Windows", chip: "arm64", file: /^Xtend-.+-arm64\.exe$/ },
  "linux-x64": { os: "Linux", chip: "x64", file: /^Xtend-.+-x86_64\.AppImage$/ },
  "linux-arm64": { os: "Linux", chip: "arm64", file: /^Xtend-.+-arm64\.AppImage$/ },
  cli: { os: "Service and CLI", chip: "Node", file: /^xtend-cli-.+\.tgz$/ },
} as const;

export type Target = keyof typeof TARGETS;
export type Channel = "stable" | "nightly";

interface Asset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface Release {
  readonly tag_name: string;
  readonly html_url: string;
  readonly prerelease: boolean;
  readonly assets: ReadonlyArray<Asset>;
}

/**
 * The desktop target a visitor most likely wants. Every Mac says "Intel" in its user agent, so a
 * Mac starts at Apple silicon and `withArch` corrects it where the browser reports the chip.
 */
export function detect(userAgent: string, platform: string): Target {
  const both = `${platform} ${userAgent}`;
  const arm = /\b(arm|aarch64)/i.test(both);
  if (/Win/i.test(both)) return arm ? "win-arm64" : "win-x64";
  if (/Linux|X11|CrOS/i.test(both) && !/Android/i.test(userAgent))
    return arm ? "linux-arm64" : "linux-x64";
  return "mac-arm64";
}

/** `architecture` is what `navigator.userAgentData.getHighEntropyValues` reports: "arm" or "x86". */
export function withArch(target: Target, architecture: string): Target {
  const os = target.split("-")[0];
  if (os !== "mac" && os !== "win" && os !== "linux") return target;
  return `${os}-${architecture === "arm" ? "arm64" : "x64"}`;
}

export const assetsOf = (release: Release): Partial<Record<Target, Asset>> =>
  Object.fromEntries(
    Object.entries(TARGETS).flatMap(([target, { file }]) => {
      const asset = release.assets.find((a) => file.test(a.name));
      return asset === undefined ? [] : [[target, asset]];
    }),
  );

// Only GitHub's own download links reach an href, whatever the API answers.
const isGitHub = (url: unknown) => typeof url === "string" && url.startsWith("https://github.com/");

export function isRelease(value: unknown): value is Release {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<Record<keyof Release, unknown>>;
  return (
    typeof r.tag_name === "string" &&
    isGitHub(r.html_url) &&
    typeof r.prerelease === "boolean" &&
    Array.isArray(r.assets) &&
    r.assets.every(
      (a: Partial<Record<keyof Asset, unknown>>) =>
        typeof a.name === "string" && isGitHub(a.browser_download_url),
    )
  );
}

/** The newest release on a channel, or undefined when GitHub is unreachable or rate limited. */
export async function latest(channel: Channel): Promise<Release | undefined> {
  try {
    const response = await fetch(channel === "stable" ? `${API}/latest` : `${API}?per_page=20`);
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const list = Array.isArray(body) ? body : [body];
    return list.filter(isRelease).find((r) => channel === "stable" || r.prerelease);
  } catch {
    return undefined;
  }
}

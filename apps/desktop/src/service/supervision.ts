/** How the desktop keeps a service around. Pure decisions; ServiceSupervisor.ts acts on them. */

export type ServiceMode = "child" | "launchd" | "remote" | "none";

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** A child that stayed up this long starts the backoff ladder over on its next crash. */
const STABLE_MS = 60_000;

export interface Probe {
  /** GET /api/health answered on the configured URL. */
  readonly reachable: boolean;
  /** The URL points at this machine; only then may the desktop spawn or expect launchd. */
  readonly loopback: boolean;
  readonly launchdLoaded: boolean;
}

/** Which mode the probe puts us in and whether to spawn a child. */
export const decide = (probe: Probe): { readonly mode: ServiceMode; readonly spawn: boolean } => {
  if (!probe.loopback) return { mode: "remote", spawn: false };
  if (probe.launchdLoaded) return { mode: "launchd", spawn: false };
  if (probe.reachable) return { mode: "none", spawn: false };
  return { mode: "child", spawn: true };
};

/** Delay before the next restart, counting attempts since the last stable run. */
export const nextRestart = (
  attempt: number,
  uptimeMs: number,
): { readonly attempt: number; readonly delayMs: number } => {
  const next = uptimeMs >= STABLE_MS ? 0 : attempt + 1;
  return { attempt: next, delayMs: BACKOFF_MS[Math.min(next, BACKOFF_MS.length - 1)]! };
};

/** `xtend://compose?text=...` and `xtend://report?handle=...` as app routes; anything else is dropped. */
export const deepLinkToRoute = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "xtend:") return null;
  const params = new URLSearchParams();
  switch (parsed.host) {
    case "compose": {
      const text = parsed.searchParams.get("text");
      if (text !== null) params.set("text", text);
      return `/compose${params.size > 0 ? `?${params}` : ""}`;
    }
    case "report": {
      const handle = parsed.searchParams.get("handle")?.replace(/^@/, "");
      if (handle === undefined || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
      params.set("handle", handle);
      return `/scores?${params}`;
    }
    default:
      return null;
  }
};

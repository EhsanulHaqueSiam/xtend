import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect, onTestFinished, vi } from "vite-plus/test";

import { saveService, serviceToken, socketUrl } from "./client";

it.effect("takes ?token= out of the address bar even when the page's own token wins", () =>
  Effect.gen(function* () {
    // A packaged page the local service served, opened through a link that also carries a token.
    vi.stubEnv("DEV", false);
    const meta = document.createElement("meta");
    meta.name = "xtend-token";
    meta.content = "from-page";
    document.head.append(meta);
    const start = window.location.href;
    window.history.replaceState(null, "", "/compose?token=from-link&tab=queue#top");
    onTestFinished(() => {
      vi.unstubAllEnvs();
      meta.remove();
      window.sessionStorage.clear();
      window.history.replaceState(null, "", start);
    });

    expect(yield* serviceToken).toBe("from-page");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/compose?tab=queue#top",
    );
    // Without the page's token, as after the tab navigates, the link's token still serves it.
    meta.remove();
    expect(yield* serviceToken).toBe("from-link");
  }),
);

it.effect("a hosted page opens its socket on the saved service, keeping only a device token", () =>
  Effect.gen(function* () {
    vi.stubEnv("DEV", false);
    onTestFinished(() => {
      vi.unstubAllEnvs();
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    saveService("https://mini.ts.net", { device: "device-token" });
    expect(yield* socketUrl).toBe("wss://mini.ts.net/ws?token=device-token");
    // The service's own token cannot be revoked, so only the address outlives the tab.
    saveService("http://localhost:4820", { service: "service-token" });
    expect(yield* socketUrl).toBe("ws://localhost:4820/ws?token=service-token");
    expect(JSON.stringify(window.localStorage)).not.toContain("service-token");
  }),
);

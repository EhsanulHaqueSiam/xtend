import * as Effect from "effect/Effect";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

import { serviceToken } from "./client";

it("takes ?token= out of the address bar even when the page's own token wins", async () => {
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

  expect(await Effect.runPromise(serviceToken)).toBe("from-page");
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    "/compose?tab=queue#top",
  );
  // Without the page's token, as after the tab navigates, the link's token still serves it.
  meta.remove();
  expect(await Effect.runPromise(serviceToken)).toBe("from-link");
});

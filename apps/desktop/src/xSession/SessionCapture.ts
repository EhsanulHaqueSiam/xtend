import type { ObservationBatch } from "@corvid/contracts";
import type * as Electron from "electron";

import { isGraphqlUrl, normalizeGraphqlResponse, sourceFromOperation } from "./normalizeGraphql.ts";

/**
 * Reads GraphQL responses the session view already received and forwards the
 * posts in them to the service. Chrome DevTools Protocol, not a page script:
 * x.com's own JavaScript is never touched, and nothing is sent back to X.
 */
export interface SessionCaptureOptions {
  readonly serviceUrl: string;
  readonly viewerHandle: () => string | null;
  readonly log: (message: string, detail?: unknown) => void;
}

export function attachSessionCapture(
  contents: Electron.WebContents,
  options: SessionCaptureOptions,
): () => void {
  const pending = new Map<string, string>();
  const debug = contents.debugger;

  const onMessage = (_event: Electron.Event, method: string, params: unknown) => {
    if (!isRecord(params)) return;
    if (method === "Network.responseReceived") {
      const response = isRecord(params.response) ? params.response : undefined;
      const url = typeof response?.url === "string" ? response.url : "";
      const mime = typeof response?.mimeType === "string" ? response.mimeType : "";
      if (typeof params.requestId === "string" && isGraphqlUrl(url) && mime.includes("json")) {
        pending.set(params.requestId, url);
      }
      return;
    }
    if (method === "Network.loadingFinished" && typeof params.requestId === "string") {
      const url = pending.get(params.requestId);
      if (url === undefined) return;
      pending.delete(params.requestId);
      void captureBody(params.requestId, url);
    }
  };

  const captureBody = async (requestId: string, url: string) => {
    let body: unknown;
    try {
      const result = (await debug.sendCommand("Network.getResponseBody", { requestId })) as {
        body: string;
        base64Encoded: boolean;
      };
      body = JSON.parse(
        result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body,
      );
    } catch (error) {
      // Bodies for aborted or evicted requests are gone; nothing to record.
      options.log("response body unavailable", { url, error: String(error) });
      return;
    }
    const posts = normalizeGraphqlResponse(body);
    if (posts.length === 0) return;
    const batch: ObservationBatch = {
      viewerHandle: options.viewerHandle(),
      source: sourceFromOperation(url),
      observedAt: new Date().toISOString(),
      posts,
    };
    try {
      const response = await fetch(new URL("/api/observations", options.serviceUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!response.ok) options.log("service rejected batch", { status: response.status });
    } catch (error) {
      options.log("service unreachable", { error: String(error) });
    }
  };

  try {
    debug.attach("1.3");
  } catch (error) {
    options.log("debugger attach failed", { error: String(error) });
    return () => {};
  }
  debug.on("message", onMessage);
  void debug.sendCommand("Network.enable").catch((error: unknown) => {
    options.log("Network.enable failed", { error: String(error) });
  });

  return () => {
    debug.off("message", onMessage);
    if (debug.isAttached()) debug.detach();
    pending.clear();
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

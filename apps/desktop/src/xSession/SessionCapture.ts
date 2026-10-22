import * as fs from "node:fs";
import * as path from "node:path";

import type { ObservationBatch } from "@xtend/contracts";
import type * as Electron from "electron";

import {
  isGraphqlUrl,
  isViewerOperation,
  normalizeGraphqlResponse,
  readViewerHandle,
  sourceFromOperation,
} from "./normalizeGraphql.ts";

const REATTACH_MS = 2_000;
const DRAIN_MS = 30_000;

/**
 * Reads GraphQL responses the session view already received and forwards the
 * posts in them to the service. Chrome DevTools Protocol, not a page script:
 * x.com's own JavaScript is never touched, and nothing is sent back to X.
 */
export interface SessionCaptureOptions {
  readonly serviceUrl: string;
  /** Bearer token for the service's observations route. */
  readonly serviceToken: string;
  /** Batches the service did not acknowledge wait here until it is back. */
  readonly queueDir: string;
  readonly log: (message: string, detail?: unknown) => void;
}

export function attachSessionCapture(
  contents: Electron.WebContents,
  options: SessionCaptureOptions,
): () => void {
  const pending = new Map<string, string>();
  const debug = contents.debugger;
  // Learned from x.com's own Viewer call; null until the session has loaded once.
  let viewerHandle: string | null = null;
  let stopped = false;
  let reattachTimer: ReturnType<typeof setTimeout> | undefined;

  const onMessage = (_event: Electron.Event, method: string, params: unknown) => {
    if (!isRecord(params) || typeof params.requestId !== "string") return;
    if (method === "Network.responseReceived") {
      const response = isRecord(params.response) ? params.response : undefined;
      const url = typeof response?.url === "string" ? response.url : "";
      const mime = typeof response?.mimeType === "string" ? response.mimeType : "";
      if (isGraphqlUrl(url) && mime.includes("json")) pending.set(params.requestId, url);
      return;
    }
    if (method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      return;
    }
    if (method === "Network.loadingFinished") {
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
    if (isViewerOperation(url)) {
      viewerHandle = readViewerHandle(body) ?? viewerHandle;
      return;
    }
    const posts = normalizeGraphqlResponse(body);
    if (posts.length === 0) return;
    await send({
      viewerHandle,
      source: sourceFromOperation(url),
      observedAt: new Date().toISOString(),
      posts,
    });
  };

  /** True when the service acknowledged the batch; a rejected batch is logged and dropped. */
  const post = async (batch: ObservationBatch): Promise<boolean> => {
    const response = await fetch(new URL("/api/observations", options.serviceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.serviceToken}`,
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) options.log("service rejected batch", { status: response.status });
    return true;
  };

  const send = async (batch: ObservationBatch) => {
    try {
      await post(batch);
      await drainQueue();
    } catch (error) {
      options.log("service unreachable, queued batch", { error: String(error) });
      enqueue(batch);
    }
  };

  const enqueue = (batch: ObservationBatch) => {
    try {
      fs.mkdirSync(options.queueDir, { recursive: true });
      const name = `${batch.observedAt.replaceAll(":", "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
      fs.writeFileSync(path.join(options.queueDir, name), JSON.stringify(batch));
    } catch (error) {
      options.log("could not queue batch", { error: String(error) });
    }
  };

  let draining = false;
  const drainQueue = async () => {
    if (draining || !fs.existsSync(options.queueDir)) return;
    draining = true;
    try {
      // Oldest first; file names start with the observation time.
      for (const name of fs.readdirSync(options.queueDir).sort()) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(options.queueDir, name);
        const batch = JSON.parse(fs.readFileSync(file, "utf8")) as ObservationBatch;
        // eslint-disable-next-line no-await-in-loop -- replayed in order; a failure stops the drain where it is.
        await post(batch);
        fs.rmSync(file, { force: true });
      }
    } catch {
      // Still down; the next successful send tries again.
    } finally {
      draining = false;
    }
  };
  const drainTimer = setInterval(() => void drainQueue(), DRAIN_MS);

  const attach = () => {
    if (stopped) return;
    try {
      debug.attach("1.3");
    } catch (error) {
      options.log("debugger attach failed", { error: String(error) });
      return;
    }
    void debug.sendCommand("Network.enable").catch((error: unknown) => {
      options.log("Network.enable failed", { error: String(error) });
    });
  };

  // DevTools opening on the view, or a renderer crash, detaches us; come back once it settles.
  const onDetach = (_event: Electron.Event, reason: string) => {
    pending.clear();
    if (stopped) return;
    options.log("debugger detached, reattaching", { reason });
    reattachTimer = setTimeout(attach, REATTACH_MS);
  };

  debug.on("message", onMessage);
  debug.on("detach", onDetach);
  attach();

  return () => {
    stopped = true;
    clearTimeout(reattachTimer);
    clearInterval(drainTimer);
    debug.off("message", onMessage);
    debug.off("detach", onDetach);
    if (debug.isAttached()) debug.detach();
    pending.clear();
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

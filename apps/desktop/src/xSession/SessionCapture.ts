import * as fs from "node:fs";
import * as path from "node:path";

import type { EngineBatch, ObservationBatch, ObservedPost } from "@xtend/contracts";
import type * as Electron from "electron";

import {
  isCreateTweetOperation,
  isGraphqlUrl,
  isViewerOperation,
  normalizeGraphqlResponse,
  readCreatedPostId,
  readViewerHandle,
  sourceFromOperation,
} from "./normalizeGraphql.ts";
import { hasEngineContent, renderEngineBatch, requestVariables } from "./engineBatch.ts";

const REATTACH_MS = 2_000;
const DRAIN_MS = 30_000;
/** Responses that never finish (a stream, a body cut off) would otherwise stay in `pending` for good. */
const MAX_PENDING = 200;
/** A service away for days must not fill the disk; the oldest observations are worth least. */
const MAX_QUEUED = 1_000;

/**
 * Reads GraphQL responses the session view already received and forwards the
 * posts in them to the service. Chrome DevTools Protocol, not a page script:
 * x.com's own JavaScript is never touched, and nothing is sent back to X.
 */
export interface SessionCaptureOptions {
  readonly serviceUrl: string;
  /** Bearer token for the service's observations route. */
  readonly serviceToken: string;
  /** The account whose session partition this view is; every batch is filed under it. */
  readonly accountId: number;
  /** Batches the service did not acknowledge wait here until it is back. */
  readonly queueDir: string;
  readonly log: (message: string, detail?: unknown) => void;
  /** Every batch the normalizer recognized, before it is sent; the overlay feeds on it. */
  readonly onPosts?: (posts: ReadonlyArray<ObservedPost>, viewerHandle: string | null) => void;
  /** Every response's posts as Xtend's own X screens draw them, tagged with X's operation. */
  readonly onRender?: (batch: EngineBatch) => void;
  /** The id x.com returned for a post the session just created (CreateTweet). */
  readonly onCreatedPost?: (postId: string) => void;
  /** The signed-in handle from X's nav, for sessions that never make the Viewer call. */
  readonly fallbackViewer?: () => string | null;
}

export function attachSessionCapture(
  contents: Electron.WebContents,
  options: SessionCaptureOptions,
): () => void {
  const pending = new Map<string, string>();
  // A POST's body (X sends HomeTimeline as one) holds the variables that say which Home tab it is for.
  const postData = new Map<string, string>();
  const debug = contents.debugger;
  // Learned from x.com's own Viewer call; null until the session has loaded once.
  let viewerHandle: string | null = null;
  let stopped = false;
  let reattachTimer: ReturnType<typeof setTimeout> | undefined;

  const onMessage = (_event: Electron.Event, method: string, params: unknown) => {
    if (!isRecord(params) || typeof params.requestId !== "string") return;
    if (method === "Network.requestWillBeSent") {
      const request = isRecord(params.request) ? params.request : undefined;
      if (typeof request?.postData === "string" && isGraphqlUrl(String(request.url))) {
        postData.set(params.requestId, request.postData);
        if (postData.size > MAX_PENDING) postData.delete(postData.keys().next().value!);
      }
      return;
    }
    if (method === "Network.responseReceived") {
      const response = isRecord(params.response) ? params.response : undefined;
      const url = typeof response?.url === "string" ? response.url : "";
      const mime = typeof response?.mimeType === "string" ? response.mimeType : "";
      if (!isGraphqlUrl(url) || !mime.includes("json")) return;
      pending.set(params.requestId, url);
      // Maps iterate in insertion order, so the first key is the oldest request.
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value!);
      return;
    }
    if (method === "Network.loadingFailed") {
      pending.delete(params.requestId);
      postData.delete(params.requestId);
      return;
    }
    if (method === "Network.loadingFinished") {
      const url = pending.get(params.requestId);
      if (url === undefined) return;
      pending.delete(params.requestId);
      const sent = postData.get(params.requestId);
      postData.delete(params.requestId);
      void captureBody(params.requestId, url, sent);
    }
  };

  const captureBody = async (requestId: string, url: string, sent: string | undefined) => {
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
    if (options.onRender !== undefined) {
      // /i/api/graphql/<queryId>/<Operation>?variables=...
      const op = new URL(url).pathname.split("/").at(-1) ?? "";
      const batch = renderEngineBatch(op, requestVariables(url, sent), body);
      if (hasEngineContent(batch)) options.onRender(batch);
    }
    if (isCreateTweetOperation(url)) {
      const created = readCreatedPostId(body) ?? posts[0]?.postId;
      if (created !== undefined) options.onCreatedPost?.(created);
    }
    if (posts.length === 0) return;
    const viewer = viewerHandle ?? options.fallbackViewer?.() ?? null;
    options.onPosts?.(posts, viewer);
    await send({
      viewerHandle: viewer,
      accountId: options.accountId,
      source: sourceFromOperation(url),
      observedAt: new Date().toISOString(),
      posts,
    });
  };

  /**
   * Throws when the service is unreachable or failed on its side (5xx, a proxy's 502), so the
   * batch stays queued; a batch it refused (4xx) is logged and dropped, as resending would fail the same way.
   */
  const post = async (batch: ObservationBatch): Promise<void> => {
    const response = await fetch(new URL("/api/observations", options.serviceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.serviceToken}`,
      },
      body: JSON.stringify(batch),
    });
    if (response.status >= 500) throw new Error(`service answered ${response.status}`);
    if (!response.ok) options.log("service rejected batch", { status: response.status });
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
      const queued = fs.readdirSync(options.queueDir).filter((n) => n.endsWith(".json"));
      for (const old of queued.sort().slice(0, -MAX_QUEUED))
        fs.rmSync(path.join(options.queueDir, old), { force: true });
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
        let batch: ObservationBatch;
        try {
          batch = JSON.parse(fs.readFileSync(file, "utf8")) as ObservationBatch;
        } catch (error) {
          // A file cut short by a crash mid-write sorts first forever and would hold back every batch after it.
          options.log("dropped unreadable queued batch", { name, error: String(error) });
          fs.rmSync(file, { force: true });
          continue;
        }
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

  let attachFailing = false;
  const attach = () => {
    if (stopped) return;
    try {
      debug.attach("1.3");
    } catch (error) {
      // DevTools opened on the window holds the debugger; keep trying until it lets go.
      if (!attachFailing) options.log("debugger attach failed, retrying", { error: String(error) });
      attachFailing = true;
      reattachTimer = setTimeout(attach, REATTACH_MS);
      return;
    }
    attachFailing = false;
    void debug.sendCommand("Network.enable").catch((error: unknown) => {
      options.log("Network.enable failed", { error: String(error) });
    });
  };

  // DevTools opening on the view, or a renderer crash, detaches us; come back once it settles.
  const onDetach = (_event: Electron.Event, reason: string) => {
    pending.clear();
    postData.clear();
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

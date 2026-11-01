import { session } from "electron";

import { hostOf, isXHost } from "./guestPolicy.ts";

/**
 * Mock X for dev and tests (`XTEND_MOCK_X=<origin>`, see apps/e2e/src/mockX): the session view
 * loads https://x.com as ever, so main's x.com gating, capture and webview policy run unchanged,
 * but its partition answers every x.com request from the mock and lets nothing else leave the
 * machine. Never in a packaged build, never on an account's partition.
 */

/** In memory, not `persist:`: nothing of the mock reaches disk, and it can never be an account's. */
export const MOCK_X_PARTITION = "x-mock";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const isLoopback = (url: string) => LOOPBACK.has(hostOf(url));

/**
 * The mock's origin from XTEND_MOCK_X, or null: unset, a packaged build (a user's app never
 * serves X from anywhere but X), or anything but an http origin on this machine.
 */
export function mockXOrigin(value: string | undefined, packaged: boolean): string | null {
  if (value === undefined || value === "" || packaged) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopback(value) ? url.origin : null;
  } catch {
    return null;
  }
}

const guarded = new WeakSet<Electron.Session>();

/**
 * Serves x.com on `xSession` from the mock at `origin`, and keeps the app page's session on this
 * machine too. Every other host the session view asks for is refused and logged. Once per session.
 */
export function useMockX(
  xSession: Electron.Session,
  origin: string,
  log: (message: string, detail?: unknown) => void,
) {
  if (!guarded.has(xSession)) {
    guarded.add(xSession);
    const forward = async (request: Request) => {
      if (!isXHost(request.url)) {
        log("mock X refused a request off the machine", request.url);
        return new Response(null, { status: 404 });
      }
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      if (request.referrer !== "" && request.referrer !== "about:client")
        headers.set("referer", request.referrer);
      // Node's fetch from main, so the request reaches the mock rather than this handler again.
      return fetch(new URL(url.pathname + url.search, origin), {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? null
            : await request.arrayBuffer(),
      });
    };
    xSession.protocol.handle("https", forward);
    xSession.protocol.handle("http", forward);
    // Sockets are not protocol requests; X's page opens none on the mock.
    xSession.webRequest.onBeforeRequest({ urls: ["ws://*/*", "wss://*/*"] }, (_details, callback) =>
      callback({ cancel: true }),
    );
  }
  const app = session.defaultSession;
  if (!guarded.has(app)) {
    guarded.add(app);
    app.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      const leaves = /^(https?|wss?):/.test(details.url) && !isLoopback(details.url);
      if (leaves) log("mock X refused an app request off the machine", details.url);
      callback({ cancel: leaves });
    });
  }
}

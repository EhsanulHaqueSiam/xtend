import * as NodeEvents from "node:events";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { clientScript, shell } from "./client.ts";
import {
  askToJoinDialog,
  leaveCommunitySheet,
  menuRows,
  opHash,
  subscribeDialog,
  unfollowSheet,
} from "./menus.ts";
import { pollMarkup, postsOf, route } from "./pages.ts";
import { createMockState, type GraphqlRequest, type Json } from "./state.ts";

/**
 * Mock X over HTTP on 127.0.0.1: every x.com page path answers with mock X's document, and
 * `/i/api/graphql/<hash>/<Op>` and `/i/api/1.1/...` answer as X does, from the mock's state.
 * `/__mock/*` is the page script's own plumbing and the press log. It calls nothing outside itself.
 */

/** X's writes among its GraphQL operations; every other operation is a read. */
const WRITES = new Set([
  "FavoriteTweet",
  "UnfavoriteTweet",
  "CreateRetweet",
  "DeleteRetweet",
  "CreateBookmark",
  "DeleteBookmark",
  "CreateTweet",
  "DeleteTweet",
  "PinTweet",
  "MuteConversation",
  "UnmuteConversation",
  "JoinCommunity",
  "RequestToJoinCommunity",
  "LeaveCommunity",
  "PinTimeline",
  "UnpinTimeline",
]);
/** X sends Home's timelines as POSTs, its other reads as GETs. */
const POSTED = new Set(["HomeTimeline", "HomeLatestTimeline"]);
const FEATURES = JSON.stringify({ responsive_web_graphql_timeline_navigation_enabled: true });

/** A GraphQL call as the page makes it: the URL, and for a POST its body. */
const httpRequest = (r: GraphqlRequest) => {
  const path = `/i/api/graphql/${opHash(r.op)}/${r.op}`;
  return POSTED.has(r.op)
    ? {
        url: path,
        body: JSON.stringify({
          variables: r.variables,
          features: JSON.parse(FEATURES),
          queryId: opHash(r.op),
        }),
      }
    : {
        url: `${path}?${new URLSearchParams({ variables: JSON.stringify(r.variables), features: FEATURES })}`,
      };
};

const readBody = async (req: NodeHttp.IncomingMessage): Promise<Json> => {
  const chunks: Array<Buffer> = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Json) : {};
  } catch {
    // X's REST writes send a form.
    return Object.fromEntries(new URLSearchParams(raw));
  }
};

/** Starts mock X on `port` (0 picks one). `close` stops it. */
export async function startMockX(options: { readonly port?: number } = {}) {
  const state = createMockState();
  /** Every GraphQL read the page made, with its variables, in order. */
  const reads: Array<GraphqlRequest> = [];
  const ops = [...WRITES, ...POSTED];
  const hashes = Object.fromEntries(ops.map((op) => [op, opHash(op)]));

  const handle = async (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => {
    const url = new URL(req.url ?? "/", "https://x.com");
    const from = (() => {
      try {
        const referer = new URL(req.headers.referer ?? "");
        return referer.pathname + referer.search;
      } catch {
        return url.pathname;
      }
    })();
    const send = (status: number, body: string, type: string) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    const json = (body: unknown) =>
      send(200, JSON.stringify(body), "application/json; charset=utf-8");

    const graphql = /^\/i\/api\/graphql\/[^/]+\/([A-Za-z]+)$/.exec(url.pathname);
    if (graphql !== null) {
      const op = graphql[1]!;
      if (req.method === "POST") {
        const body = await readBody(req);
        const variables = (
          typeof body.variables === "object" && body.variables !== null ? body.variables : {}
        ) as Json;
        if (WRITES.has(op)) return json(state.write(op, variables, from));
        reads.push({ op, variables });
        return json(state.respond(op, variables));
      }
      let variables: Json = {};
      try {
        variables = JSON.parse(url.searchParams.get("variables") ?? "{}") as Json;
      } catch {}
      reads.push({ op, variables });
      return json(state.respond(op, variables));
    }
    const restWrite = /^\/i\/api\/1\.1\/(.+)\.json$/.exec(url.pathname);
    if (restWrite !== null && req.method === "POST")
      return json(state.write(restWrite[1]!, await readBody(req), from));

    switch (url.pathname) {
      case "/__mock/client.js":
        return send(200, clientScript(), "text/javascript; charset=utf-8");
      case "/__mock/view": {
        const path = url.searchParams.get("path") ?? "/home";
        const cursor = url.searchParams.get("cursor");
        const r = route(state, path, url.searchParams.get("tab") ?? "forYou");
        if (cursor !== null) {
          const paged = r.paged === undefined ? undefined : r.requests[r.paged];
          if (paged === undefined)
            return json({ graphql: [], html: "", next: null, title: r.title });
          const next = { ...paged, variables: { ...paged.variables, cursor } };
          const batch = state.batchFor(next.op, next.variables);
          return json({
            graphql: [httpRequest(next)],
            html: postsOf(batch, state),
            next: batch?.bottom ?? null,
            title: r.title,
          });
        }
        const batches = r.requests.map((q) => state.batchFor(q.op, q.variables));
        const boot = url.searchParams.get("boot") === "1" ? [{ op: "Viewer", variables: {} }] : [];
        return json({
          graphql: [...boot, ...r.requests].map(httpRequest),
          html: r.render(batches),
          next: r.paged === undefined ? null : (batches[r.paged]?.bottom ?? null),
          title: r.title,
        });
      }
      case "/__mock/trend": {
        const body = await readBody(req);
        state.setTrendHidden(String(body.path), String(body.name), body.hidden === true);
        return json({ ok: true });
      }
      case "/__mock/menu":
        return json(menuRows(state, url.searchParams.get("spec") ?? ""));
      case "/__mock/dialog": {
        const [kind, userId = ""] = (url.searchParams.get("spec") ?? "").split(":");
        if (kind === "join" || kind === "leave") {
          const c = state.community(userId);
          if (c === undefined) return send(404, "{}", "application/json");
          return json(kind === "join" ? askToJoinDialog(c) : leaveCommunitySheet(c));
        }
        const u = state.user(userId);
        if (u === undefined) return send(404, "{}", "application/json");
        return json(
          kind === "unfollow" ? unfollowSheet(u.userId, u.handle) : subscribeDialog(u.handle),
        );
      }
      case "/__mock/poll": {
        const p = state.post(url.searchParams.get("id") ?? "");
        return p?.poll == null
          ? send(404, "", "text/html")
          : send(200, pollMarkup(p), "text/html; charset=utf-8");
      }
      case "/__mock/press": {
        const body = await readBody(req);
        state.presses.push({
          kind: "press",
          name: String(body.name ?? ""),
          target: typeof body.target === "string" ? body.target : null,
          path: String(body.path ?? from),
        });
        return json({ ok: true });
      }
      case "/__mock/presses":
        return json(state.presses);
      case "/favicon.ico":
        return send(204, "", "image/x-icon");
    }
    if (req.method !== "GET" || url.pathname.startsWith("/i/api/"))
      return send(404, "{}", "application/json");
    return send(200, shell(state, hashes), "text/html; charset=utf-8");
  };

  const server = NodeHttp.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error));
    });
  });
  server.listen(options.port ?? 0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(server, "listening");
  const { port } = server.address() as NodeNet.AddressInfo;
  return {
    /** Where mock X answers; the desktop serves https://x.com from it (XTEND_MOCK_X). */
    url: `http://127.0.0.1:${port}`,
    state,
    reads,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // The webview keeps its connections open; they would hold the close for good.
        server.closeAllConnections();
      }),
  };
}

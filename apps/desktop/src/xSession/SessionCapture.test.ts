import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ObservationBatch } from "@xtend/contracts";
import type * as Electron from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { attachSessionCapture } from "./SessionCapture.ts";

const GRAPHQL = "https://x.com/i/api/graphql/abc";

const tweet = (id: string) => ({
  __typename: "Tweet",
  rest_id: id,
  core: {
    user_results: { result: { rest_id: "10", core: { screen_name: "LevelsIO", name: "Pieter" } } },
  },
  views: { count: "500" },
  legacy: {
    full_text: "hi",
    created_at: "Wed Oct 22 04:00:00 +0000 2026",
    favorite_count: 1,
    retweet_count: 0,
    reply_count: 0,
    quote_count: 0,
  },
});

/** Plays the window's `contents.debugger`: CDP events in, response bodies out. */
class FakeDebugger extends EventEmitter {
  attached = false;
  /** Set while DevTools holds the target, so attach throws as Electron does. */
  held = false;
  readonly commands: Array<string> = [];
  private readonly bodies = new Map<string, { body: string; base64Encoded: boolean }>();

  attach() {
    if (this.held) throw new Error("Another debugger is already attached");
    this.attached = true;
  }
  isAttached() {
    return this.attached;
  }
  detach() {
    this.attached = false;
  }
  async sendCommand(method: string, params?: { requestId?: string }) {
    this.commands.push(method);
    if (method !== "Network.getResponseBody") return {};
    const body = this.bodies.get(params?.requestId ?? "");
    if (body === undefined) throw new Error("No resource with given identifier found");
    return body;
  }
  received(requestId: string, url: string, body: unknown, base64Encoded = false) {
    const text = JSON.stringify(body);
    this.bodies.set(requestId, {
      body: base64Encoded ? Buffer.from(text).toString("base64") : text,
      base64Encoded,
    });
    this.emit("message", {}, "Network.responseReceived", {
      requestId,
      response: { url, mimeType: "application/json" },
    });
  }
  finished(requestId: string) {
    this.emit("message", {}, "Network.loadingFinished", { requestId });
  }
}

let debug: FakeDebugger;
let queueDir: string;
let sent: Array<ObservationBatch>;
let serviceUp: boolean;
let detach: () => void;

const start = (onCreatedPost?: (postId: string) => void, accountId = 1) => {
  const contents = { debugger: debug } as unknown as Electron.WebContents;
  detach = attachSessionCapture(contents, {
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "tok",
    accountId,
    queueDir,
    log: () => {},
    ...(onCreatedPost === undefined ? {} : { onCreatedPost }),
  });
};

beforeEach(() => {
  debug = new FakeDebugger();
  queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "xtend-capture-"));
  sent = [];
  serviceUp = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      if (!serviceUp) throw new TypeError("fetch failed");
      expect(url.toString()).toBe("http://127.0.0.1:4820/api/observations");
      expect(init.headers).toMatchObject({ authorization: "Bearer tok" });
      sent.push(JSON.parse(String(init.body)) as ObservationBatch);
      return new Response(null, { status: 202 });
    }),
  );
});

afterEach(() => {
  detach();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fs.rmSync(queueDir, { recursive: true, force: true });
});

it("sends the posts in GraphQL responses the window received, base64 bodies too, and nothing else", async () => {
  const created: Array<string> = [];
  start((postId) => created.push(postId));
  debug.received("1", `${GRAPHQL}/Viewer`, {
    data: { viewer: { user_results: { result: { core: { screen_name: "LevelsIO" } } } } },
  });
  debug.finished("1");
  debug.received("2", "https://x.com/i/api/1.1/jot/client_event.json", { posts: [tweet("7")] });
  debug.finished("2");
  debug.received("3", `${GRAPHQL}/HomeTimeline?variables=%7B%7D`, { data: [tweet("8")] }, true);
  debug.finished("3");
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toMatchObject({ viewerHandle: "levelsio", source: "home" });
  expect(sent[0]?.posts.map((p) => p.postId)).toEqual(["8"]);

  // X's create results carry no __typename; a long post goes through CreateNoteTweet.
  const { __typename: _, ...result } = tweet("9");
  debug.received("4", `${GRAPHQL}/CreateTweet`, {
    data: { create_tweet: { tweet_results: { result } } },
  });
  debug.finished("4");
  debug.received("5", `${GRAPHQL}/CreateNoteTweet`, {
    data: { notetweet_create: { tweet_results: { result: { ...result, rest_id: "10" } } } },
  });
  debug.finished("5");
  await vi.waitFor(() => expect(created).toEqual(["9", "10"]));
});

it("keeps batches on disk while the service is down and replays them, past a corrupt file", async () => {
  start();
  serviceUp = false;
  debug.received("1", `${GRAPHQL}/UserTweets`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() => expect(fs.readdirSync(queueDir)).toHaveLength(1));
  // A batch cut short by a crash mid-write; it sorts before every real one.
  fs.writeFileSync(path.join(queueDir, "0000-cut-short.json"), '{"posts": [');

  serviceUp = true;
  debug.received("2", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  debug.finished("2");
  await vi.waitFor(() => expect(fs.readdirSync(queueDir)).toEqual([]));
  expect(sent.map((b) => [b.source, b.posts[0]?.postId])).toEqual([
    ["home", "2"],
    ["profile", "1"],
  ]);
});

it("a batch queued before an account switch still names the account that captured it", async () => {
  start();
  serviceUp = false;
  debug.received("1", `${GRAPHQL}/HomeTimeline`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() => expect(fs.readdirSync(queueDir)).toHaveLength(1));

  // The switch rebuilds the window on account 2's session, sharing the queue.
  detach();
  debug = new FakeDebugger();
  start(undefined, 2);
  serviceUp = true;
  debug.received("2", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  debug.finished("2");
  await vi.waitFor(() => expect(fs.readdirSync(queueDir)).toEqual([]));
  expect(sent.map((b) => [b.posts[0]?.postId, b.accountId])).toEqual([
    ["2", 2],
    ["1", 1],
  ]);
});

it("keeps at most 1000 queued batches while the service is away, dropping the oldest", async () => {
  start();
  serviceUp = false;
  for (let i = 0; i < 1_000; i++)
    fs.writeFileSync(
      path.join(queueDir, `2026-01-01T00-00-00.${String(i).padStart(3, "0")}Z-x.json`),
      "{}",
    );
  debug.received("1", `${GRAPHQL}/HomeTimeline`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() =>
    expect(fs.readdirSync(queueDir)).not.toContain("2026-01-01T00-00-00.000Z-x.json"),
  );
  const queued = fs.readdirSync(queueDir);
  expect(queued).toHaveLength(1_000);
  expect(queued.some((name) => name.startsWith("2026-01-01T00-00-00.001Z"))).toBe(true);
});

it("forgets requests x.com aborted and caps the ones that never finish", async () => {
  start();
  debug.received("aborted", `${GRAPHQL}/HomeTimeline`, { data: [tweet("1")] });
  debug.emit("message", {}, "Network.loadingFailed", { requestId: "aborted" });
  debug.finished("aborted");
  debug.received("stuck", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  for (let i = 0; i < 200; i++) debug.received(`r${i}`, `${GRAPHQL}/HomeTimeline`, {});
  debug.finished("stuck");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(debug.commands).not.toContain("Network.getResponseBody");
  expect(sent).toEqual([]);
});

it("reattaches after DevTools takes the debugger, retrying while DevTools holds it", () => {
  vi.useFakeTimers();
  start();
  expect(debug.attached).toBe(true);
  debug.attached = false;
  debug.held = true;
  debug.emit("detach", {}, "replaced_with_devtools");
  vi.advanceTimersByTime(2_000);
  vi.advanceTimersByTime(2_000);
  expect(debug.attached).toBe(false);
  debug.held = false;
  vi.advanceTimersByTime(2_000);
  expect(debug.attached).toBe(true);
  expect(debug.commands.filter((c) => c === "Network.enable")).toHaveLength(2);
});

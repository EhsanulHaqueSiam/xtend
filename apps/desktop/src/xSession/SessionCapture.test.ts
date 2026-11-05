import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { EngineBatch, GrokCapture, ObservationBatch } from "@xtend/contracts";
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
class FakeDebugger extends NodeEvents.EventEmitter {
  attached = false;
  /** Set while DevTools holds the target, so attach throws as Electron does. */
  held = false;
  readonly commands: Array<string> = [];
  /** DevTools' answer to a streaming read: what it buffered before the read began. */
  streamRead: Promise<{ bufferedData?: string }> = Promise.resolve({});
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
    if (method === "Network.streamResourceContent") return this.streamRead;
    if (method !== "Network.getResponseBody") return {};
    const body = this.bodies.get(params?.requestId ?? "");
    if (body === undefined) throw new Error("No resource with given identifier found");
    return body;
  }
  received(requestId: string, url: string, body: unknown, base64Encoded = false) {
    this.receivedText(requestId, url, JSON.stringify(body), base64Encoded);
  }
  /** A body as text; `mimeType` is X's own type for one that is no one JSON value (JSON lines). */
  receivedText(
    requestId: string,
    url: string,
    text: string,
    base64Encoded = false,
    mimeType = "application/json",
  ) {
    this.bodies.set(requestId, {
      body: base64Encoded ? Buffer.from(text).toString("base64") : text,
      base64Encoded,
    });
    this.emit("message", {}, "Network.responseReceived", {
      requestId,
      response: { url, mimeType },
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
/** What a reachable service answers; a 5xx is its own failure, not a verdict on the batch. */
let serviceStatus: number;
let detach: () => void;

const start = (
  onCreatedPost?: (postId: string) => void,
  accountId = 1,
  onRender?: (batch: EngineBatch) => void,
) => {
  const contents = { debugger: debug } as unknown as Electron.WebContents;
  detach = attachSessionCapture(contents, {
    ...(onRender === undefined ? {} : { onRender }),
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
  queueDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-capture-"));
  sent = [];
  serviceUp = true;
  serviceStatus = 202;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      if (!serviceUp) throw new TypeError("fetch failed");
      if (serviceStatus >= 500) return new Response(null, { status: serviceStatus });
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
  NodeFS.rmSync(queueDir, { recursive: true, force: true });
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

it("hands a Space recording's captions from X's chat lines to the screens only, never the service", async () => {
  const rendered: Array<EngineBatch> = [];
  start(undefined, 1, (b) => rendered.push(b));
  const line = (m: Record<string, unknown>) => JSON.stringify(m);
  debug.receivedText(
    "1",
    "https://api.x.com/live-chat?broadcastId=900000700003&replay=1&cursor=1",
    [
      line({
        chatType: 45,
        final: true,
        message: "Welcome in.",
        userId: "p1",
        ts: "1793786772000000000",
      }),
      // Words X has not settled, a reaction, and a line cut off: no captions.
      line({
        chatType: 45,
        final: false,
        message: "Welc",
        userId: "p1",
        ts: "1793786771000000000",
      }),
      line({ chatType: 2, message: "💯", userId: "p2", ts: "1793786773000000000" }),
      '{"chatType":45,',
    ].join("\n"),
    false,
    "text/plain",
  );
  debug.finished("1");
  await vi.waitFor(() => expect(rendered).toHaveLength(1));
  expect([rendered[0]!.key, rendered[0]!.spaceCaptions]).toEqual([
    "900000700003",
    [{ periscopeId: "p1", text: "Welcome in.", at: "2026-11-04T10:06:12.000Z" }],
  ]);
  // A live Space's chat stream is the chat itself, not a recording's captions.
  debug.receivedText(
    "2",
    "https://api.x.com/live-chat?broadcastId=900000700003",
    line({ chatType: 45 }),
    false,
    "text/plain",
  );
  debug.finished("2");
  expect(debug.commands.filter((c) => c === "Network.getResponseBody")).toHaveLength(1);
  expect(sent).toEqual([]);
});

it("keeps batches on disk while the service is down and replays them, past a corrupt file", async () => {
  start();
  serviceUp = false;
  debug.received("1", `${GRAPHQL}/UserTweets`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toHaveLength(1));
  // A batch cut short by a crash mid-write; it sorts before every real one.
  NodeFS.writeFileSync(NodePath.join(queueDir, "0000-cut-short.json"), '{"posts": [');

  serviceUp = true;
  debug.received("2", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  debug.finished("2");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toEqual([]));
  expect(sent.map((b) => [b.source, b.posts[0]?.postId])).toEqual([
    ["home", "2"],
    ["profile", "1"],
  ]);
});

it("keeps a batch the service failed on (a proxy's 502) and sends it once the service is back", async () => {
  start();
  serviceStatus = 502;
  debug.received("1", `${GRAPHQL}/UserTweets`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toHaveLength(1));

  serviceStatus = 202;
  debug.received("2", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  debug.finished("2");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toEqual([]));
  expect(sent.map((b) => b.posts[0]?.postId)).toEqual(["2", "1"]);
});

it("a batch queued before an account switch still names the account that captured it", async () => {
  start();
  serviceUp = false;
  debug.received("1", `${GRAPHQL}/HomeTimeline`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toHaveLength(1));

  // The switch rebuilds the window on account 2's session, sharing the queue.
  detach();
  debug = new FakeDebugger();
  start(undefined, 2);
  serviceUp = true;
  debug.received("2", `${GRAPHQL}/HomeTimeline`, { data: [tweet("2")] });
  debug.finished("2");
  await vi.waitFor(() => expect(NodeFS.readdirSync(queueDir)).toEqual([]));
  expect(sent.map((b) => [b.posts[0]?.postId, b.accountId])).toEqual([
    ["2", 2],
    ["1", 1],
  ]);
});

it("keeps at most 1000 queued batches while the service is away, dropping the oldest", async () => {
  start();
  serviceUp = false;
  for (let i = 0; i < 1_000; i++)
    NodeFS.writeFileSync(
      NodePath.join(queueDir, `2026-01-01T00-00-00.${String(i).padStart(3, "0")}Z-x.json`),
      "{}",
    );
  debug.received("1", `${GRAPHQL}/HomeTimeline`, { data: [tweet("1")] });
  debug.finished("1");
  await vi.waitFor(() =>
    expect(NodeFS.readdirSync(queueDir)).not.toContain("2026-01-01T00-00-00.000Z-x.json"),
  );
  const queued = NodeFS.readdirSync(queueDir);
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
  // A finished request asks for its body at once, so none of these can still ask.
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

it("passes X's REST count of followers you know to the X screens, and nothing to the service", async () => {
  const contents = { debugger: debug } as unknown as Electron.WebContents;
  const rendered = new Promise<EngineBatch>((onRender) => {
    detach = attachSessionCapture(contents, {
      serviceUrl: "http://127.0.0.1:4820",
      serviceToken: "tok",
      accountId: 1,
      queueDir,
      log: () => {},
      onRender,
    });
  });
  debug.received("known", "https://x.com/i/api/1.1/friends/following/list.json?user_id=5&count=3", {
    users: [],
    next_cursor: 0,
    previous_cursor: 0,
    total_count: 75,
  });
  debug.finished("known");
  const batch = await rendered;
  expect([batch.key, batch.knownFollowers, sent]).toEqual(["5", 75, []]);
});

it("never reads X's Chat answers: nothing from chat's own GraphQL reaches the service or the screens", () => {
  const rendered: Array<EngineBatch> = [];
  const contents = { debugger: debug } as unknown as Electron.WebContents;
  detach = attachSessionCapture(contents, {
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "tok",
    accountId: 1,
    queueDir,
    log: () => {},
    onRender: (batch) => rendered.push(batch),
  });
  // X's chat calls its own host (api.x.com/graphql); a post shared in a chat comes through it too.
  const CHAT = "https://api.x.com/graphql/q1";
  debug.received("inbox", `${CHAT}/GetInitialXChatPageQuery`, {
    data: { get_initial_chat_page: { message_requests_count: 1, encoded_message_events: [] } },
  });
  debug.finished("inbox");
  debug.received("shared", `${CHAT}/GetPostById?variables=%7B%7D`, {
    data: { tweetResult: { result: tweet("11") } },
  });
  debug.finished("shared");
  // A finished response the capture takes asks for its body at once: these were never read.
  expect(debug.commands).not.toContain("Network.getResponseBody");
  expect([sent, rendered]).toEqual([[], []]);
});

it("hands X's older Grok client's answers to the window only: never an observation or an engine batch", async () => {
  const heard: Array<GrokCapture> = [];
  const rendered: Array<EngineBatch> = [];
  detach = attachSessionCapture({ debugger: debug } as unknown as Electron.WebContents, {
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "tok",
    accountId: 1,
    queueDir,
    log: () => {},
    onRender: (batch) => rendered.push(batch),
    onGrok: (capture) => heard.push(capture),
  });
  // A Grok conversation, even one that holds a post X sent along with it.
  const items = { message: "a private question", sender_type: "User", chat_item_id: "1" };
  debug.received(
    "1",
    `${GRAPHQL}/GrokConversationItemsByRestId?variables=%7B%22restId%22%3A%22c1%22%7D`,
    {
      data: { grok_conversation_items_by_rest_id: { items: [items] }, post: tweet("9") },
    },
  );
  debug.finished("1");
  await vi.waitFor(() => expect(heard).toHaveLength(1));
  expect(heard[0]).toMatchObject({
    kind: "graphql",
    op: "GrokConversationItemsByRestId",
    variables: { restId: "c1" },
  });
  // X's streamed answer, one JSON line per chunk, a line split across two chunks.
  debug.emit("message", {}, "Network.responseReceived", {
    requestId: "2",
    response: { url: "https://x.com/i/api/2/grok/add_response.json", mimeType: "text/plain" },
  });
  const chunk = (data: string) =>
    debug.emit("message", {}, "Network.dataReceived", {
      requestId: "2",
      data: Buffer.from(data).toString("base64"),
    });
  chunk('{"result":{"message":"Repl');
  chunk('ies"}}\n{"result":{"message":" split"}}\n');
  debug.finished("2");
  await vi.waitFor(() => expect(heard.at(-1)?.kind).toBe("end"));
  expect(heard.slice(1)).toEqual([
    { kind: "start", stream: "2", conversation: null },
    { kind: "chunk", stream: "2", line: '{"result":{"message":"Replies"}}' },
    { kind: "chunk", stream: "2", line: '{"result":{"message":" split"}}' },
    { kind: "end", stream: "2" },
  ]);
  expect(debug.commands).toContain("Network.streamResourceContent");
  // The next ordinary response goes to the service, and only its own post.
  debug.received("3", `${GRAPHQL}/HomeTimeline?variables=%7B%7D`, { data: [tweet("8")] });
  debug.finished("3");
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent.flatMap((b) => b.posts.map((p) => p.postId))).toEqual(["8"]);
  expect(rendered.map((b) => b.op)).toEqual(["HomeTimeline"]);
});

const STREAM = "https://x.com/i/api/2/grok/add_response.json";
/** The capture with X's Grok traffic heard, and what it logged. */
const startGrok = () => {
  const heard: Array<GrokCapture> = [];
  const logged: Array<unknown> = [];
  detach = attachSessionCapture({ debugger: debug } as unknown as Electron.WebContents, {
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "tok",
    accountId: 1,
    queueDir,
    log: (message, detail) => logged.push([message, detail]),
    onGrok: (capture) => heard.push(capture),
  });
  const respond = (requestId: string) =>
    debug.emit("message", {}, "Network.responseReceived", {
      requestId,
      response: { url: STREAM, mimeType: "text/plain" },
    });
  const chunk = (requestId: string, bytes: Buffer) =>
    debug.emit("message", {}, "Network.dataReceived", {
      requestId,
      data: bytes.toString("base64"),
    });
  return { heard, logged, respond, chunk };
};

it("reads what DevTools buffered before X's later chunks, and ends X's answer once, after both", async () => {
  const read = Promise.withResolvers<{ bufferedData?: string }>();
  debug.streamRead = read.promise;
  const { heard, respond, chunk } = startGrok();
  respond("2");
  chunk("2", Buffer.from('{"result":{"message":" later"}}\n'));
  debug.finished("2");
  read.resolve({
    bufferedData: Buffer.from('{"result":{"message":"first"}}\n').toString("base64"),
  });
  await vi.waitFor(() => expect(heard.at(-1)?.kind).toBe("end"));
  chunk("2", Buffer.from('{"result":{"message":" stray"}}\n'));
  expect(heard).toEqual([
    { kind: "start", stream: "2", conversation: null },
    { kind: "chunk", stream: "2", line: '{"result":{"message":"first"}}' },
    { kind: "chunk", stream: "2", line: '{"result":{"message":" later"}}' },
    { kind: "end", stream: "2" },
  ]);
});

it("keeps a character X split across chunks whole, including DevTools' buffered part", async () => {
  const line = Buffer.from('{"result":{"message":"বাংলা"}}\n');
  // Cut inside the first Bengali letter's three bytes, and again inside the next one.
  const at = line.indexOf("ব") + 1;
  debug.streamRead = Promise.resolve({ bufferedData: line.subarray(0, at).toString("base64") });
  const { heard, respond, chunk } = startGrok();
  respond("2");
  chunk("2", line.subarray(at, at + 3));
  chunk("2", line.subarray(at + 3));
  debug.finished("2");
  await vi.waitFor(() => expect(heard.at(-1)?.kind).toBe("end"));
  expect(heard[1]).toEqual({ kind: "chunk", stream: "2", line: '{"result":{"message":"বাংলা"}}' });
});

it("ends X's answers in flight when DevTools lets go of the view, and reads nothing more of them", async () => {
  const { heard, respond, chunk } = startGrok();
  respond("2");
  debug.emit("detach", {}, "target closed");
  chunk("2", Buffer.from('{"result":{"message":"after"}}\n'));
  debug.finished("2");
  expect(heard).toEqual([
    { kind: "start", stream: "2", conversation: null },
    { kind: "end", stream: "2" },
  ]);
});

it("logs only a fixed line for a Grok answer that is not JSON: no word of the user's chat", async () => {
  const { heard, logged } = startGrok();
  debug.receivedText(
    "1",
    `${GRAPHQL}/GrokConversationItemsByRestId?variables=%7B%22restId%22%3A%22c1%22%7D`,
    // V8's parse error quotes the text around where it broke.
    '{"data":{"items":[{"message":"a private question"}, x]}}',
  );
  debug.finished("1");
  await vi.waitFor(() => expect(logged).toHaveLength(1));
  expect(logged).toEqual([["grok response unavailable", undefined]]);
  expect(heard).toEqual([]);
});

it("names the conversation X's Grok ask is for when its answer starts: from its body, or its query on a resume", () => {
  const { heard, respond } = startGrok();
  const ask = (requestId: string, url: string, postData?: string) =>
    debug.emit("message", {}, "Network.requestWillBeSent", {
      requestId,
      request: { url, postData },
    });
  ask("2", STREAM, JSON.stringify({ responses: [{ message: "private" }], conversationId: "c1" }));
  ask("3", `${STREAM}?conversationId=c2&responseToChatItemId=a1`);
  respond("3");
  respond("2");
  expect(heard).toEqual([
    { kind: "start", stream: "3", conversation: "c2" },
    { kind: "start", stream: "2", conversation: "c1" },
  ]);
});

it("reads none of X's other Grok traffic: no body, no log, no observation, no engine batch", async () => {
  const { heard, logged } = startGrok();
  const rendered: Array<EngineBatch> = [];
  detach();
  detach = attachSessionCapture({ debugger: debug } as unknown as Electron.WebContents, {
    serviceUrl: "http://127.0.0.1:4820",
    serviceToken: "tok",
    accountId: 1,
    queueDir,
    log: (message, detail) => logged.push([message, detail]),
    onRender: (batch) => rendered.push(batch),
    onGrok: (capture) => heard.push(capture),
  });
  // V8's parse error would quote the text around where it broke.
  debug.receivedText("1", `${GRAPHQL}/GrokHome?variables=%7B%7D`, '{"m":"secret chat text"}, x');
  debug.received("2", `${GRAPHQL}/GrokShareConversation?variables=%7B%7D`, { data: tweet("9") });
  debug.received("3", "https://x.com/i/api/2/grok/attachment.json", { data: tweet("7") });
  debug.received("5", `${GRAPHQL}/ClearGrokConversations`, { data: tweet("6") });
  for (const id of ["1", "2", "3", "5"]) debug.finished(id);
  // An ordinary response after them is read, so theirs would have been by now.
  debug.received("4", `${GRAPHQL}/HomeTimeline?variables=%7B%7D`, { data: [tweet("8")] });
  debug.finished("4");
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent.flatMap((b) => b.posts.map((p) => p.postId))).toEqual(["8"]);
  expect(rendered.map((b) => b.op)).toEqual(["HomeTimeline"]);
  expect(debug.commands.filter((c) => c === "Network.getResponseBody")).toHaveLength(1);
  expect([heard, logged]).toEqual([[], []]);
});

it("hands the window the conversation X creates for a new chat", async () => {
  const { heard } = startGrok();
  const created = { data: { create_grok_conversation: { conversation_id: "c-new" } } };
  debug.received("1", `${GRAPHQL}/CreateGrokConversation`, created);
  debug.finished("1");
  await vi.waitFor(() =>
    expect(heard).toMatchObject([{ kind: "graphql", op: "CreateGrokConversation", body: created }]),
  );
});

import { DESKTOP_COMMAND_LIMIT_MS } from "@xtend/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { XPost } from "@xtend/contracts";
import type { OverlaySave } from "../ipc/channels.ts";
import { commandRunner, overlaySaver, postThroughComposer } from "./DesktopCommands.ts";

// x.com's DOM over CDP: the home page's inline composer first, the compose modal after it in
// X's layers root, with the same test ids. Node ids: 1x inline, 2x modal.
const MATCHES: Record<string, Array<number>> = {
  'div[data-testid="tweetTextarea_0"]': [11, 21],
  'input[data-testid="fileInput"]': [12, 22],
  'button[data-testid="tweetButton"]': [23],
};
/** Content quads, clockwise from the top-left corner. */
const BOXES: Record<number, Array<number>> = {
  11: [600, 280, 800, 280, 800, 320, 600, 320],
  21: [100, 50, 300, 50, 300, 90, 100, 90],
  23: [500, 200, 560, 200, 560, 236, 500, 236],
};

it("types into the compose modal, not the inline composer behind it, and presses Post once uploads finish", async () => {
  const log: Array<string> = [];
  const loaded: Array<string> = [];
  let buttonPolls = 0;
  const cdp = async (method: string, params: Record<string, unknown> = {}) => {
    switch (method) {
      case "DOM.getDocument":
        return { root: { nodeId: 1 } };
      case "DOM.querySelectorAll":
        return { nodeIds: MATCHES[String(params.selector)] ?? [] };
      case "DOM.getAttributes":
        // Post stays disabled while the media uploads.
        if (params.nodeId === 23 && buttonPolls++ === 0) {
          log.push("button disabled");
          return { attributes: ["aria-disabled", "true"] };
        }
        return { attributes: [] };
      case "DOM.getBoxModel":
        return { model: { content: BOXES[Number(params.nodeId)] } };
      case "Input.dispatchMouseEvent":
        if (params.type === "mousePressed") log.push(`press ${params.x},${params.y}`);
        return {};
      case "Input.insertText":
        log.push(`type ${params.text}`);
        return {};
      case "DOM.setFileInputFiles":
        log.push(`files ${params.nodeId} ${String(params.files)}`);
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  };

  const postId = await postThroughComposer(
    { loadURL: async (url) => void loaded.push(url) },
    cdp,
    { type: "sessionPost", text: "hello", mediaPaths: ["/tmp/a.png"], replyToPostId: "42" },
    () => {
      log.push("listening for CreateTweet");
      return Promise.resolve("777");
    },
    Date.now() + 60_000,
  );

  expect(postId).toBe("777");
  expect(loaded).toEqual(["https://x.com/intent/post?in_reply_to=42"]);
  expect(log).toEqual([
    "press 200,70",
    "type hello",
    "files 22 /tmp/a.png",
    "listening for CreateTweet",
    "button disabled",
    "press 530,218",
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The compose modal over CDP; Post stays disabled until `uploadedAt`. Logs what a user would see happen. */
const composer = (log: Array<string>, uploadedAt = 0) => ({
  contents: {
    loadURL: async (url: string) => void log.push(`load ${url}`),
  },
  cdp: async (method: string, params: Record<string, unknown> = {}) => {
    switch (method) {
      case "DOM.getDocument":
        return { root: { nodeId: 1 } };
      case "DOM.querySelectorAll":
        return { nodeIds: MATCHES[String(params.selector)] ?? [] };
      case "DOM.getAttributes":
        return {
          attributes:
            params.nodeId === 23 && Date.now() < uploadedAt ? ["aria-disabled", "true"] : [],
        };
      case "DOM.getBoxModel":
        return { model: { content: BOXES[Number(params.nodeId)] } };
      case "Input.dispatchMouseEvent":
        // 530 is the middle of the Post button's box.
        if (params.type === "mousePressed" && params.x === 530) log.push("press Post");
        return {};
      case "Input.insertText":
        log.push(`type ${params.text}`);
        return {};
      case "DOM.setFileInputFiles":
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  },
});

const post = (text: string, mediaPaths: Array<string> = []) =>
  ({ type: "sessionPost", text, mediaPaths }) as const;

it("waits for a long video upload, past the 15s the composer itself gets", async () => {
  vi.useFakeTimers();
  const log: Array<string> = [];
  const page = composer(log, Date.now() + 90_000);
  const run = commandRunner({
    ...page,
    navigate: () => {},
    nextCreatedPost: () => new Promise((resolve) => setTimeout(() => resolve("9"), 1_000)),
    sessionPostingEnabled: async () => true,
  });
  const result = run(post("clip", ["/tmp/clip.mp4"]));
  await vi.advanceTimersByTimeAsync(92_000);
  await expect(result).resolves.toEqual({ type: "sessionPost", postId: "9" });
  expect(log.filter((l) => l === "press Post")).toHaveLength(1);
});

it("runs a post that arrives over a new socket only after the one orphaned by the old socket ends", async () => {
  const log: Array<string> = [];
  const page = composer(log);
  let finishFirstLoad = () => {};
  let loads = 0;
  const ids = ["1", "2"];
  const run = commandRunner({
    contents: {
      loadURL: (url) => {
        log.push(`load ${url}`);
        // The first post's page is still loading when the socket drops.
        return loads++ === 0
          ? new Promise<void>((resolve) => (finishFirstLoad = resolve))
          : Promise.resolve();
      },
    },
    cdp: page.cdp,
    navigate: () => {},
    nextCreatedPost: async () => ids.shift()!,
    sessionPostingEnabled: async () => true,
  });

  const first = run(post("first"));
  const second = run(post("second"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  // The second post must not navigate away from the first one's composer.
  expect(log).toEqual(["load https://x.com/compose/post"]);

  finishFirstLoad();
  await expect(first).resolves.toEqual({ type: "sessionPost", postId: "1" });
  await expect(second).resolves.toEqual({ type: "sessionPost", postId: "2" });
  expect(log).toEqual([
    "load https://x.com/compose/post",
    "type first",
    "press Post",
    "load https://x.com/compose/post",
    "type second",
    "press Post",
  ]);
});

it("gives up on a composer that never loads by the limit, and refuses what waited behind it untouched", async () => {
  vi.useFakeTimers();
  const log: Array<string> = [];
  const run = commandRunner({
    contents: {
      loadURL: (url) => {
        log.push(`load ${url}`);
        return new Promise(() => {});
      },
    },
    cdp: composer(log).cdp,
    navigate: (url) => log.push(`navigate ${url}`),
    nextCreatedPost: () => new Promise(() => {}),
    sessionPostingEnabled: async () => true,
  });
  const stuck = run(post("first"));
  const queued = run({ type: "sessionNavigate", url: "https://x.com/i/web/status/1" });
  const outcomes = Promise.allSettled([stuck, queued]);
  await vi.advanceTimersByTimeAsync(DESKTOP_COMMAND_LIMIT_MS.sessionPost);
  const [a, b] = await outcomes;
  // Neither got as far as typing, so the service may safely send them again.
  expect(a).toMatchObject({
    status: "rejected",
    reason: { message: "x.com's composer did not load", notAttempted: true },
  });
  expect(b).toMatchObject({
    status: "rejected",
    reason: {
      message: "sessionNavigate waited out its time behind another command",
      notAttempted: true,
    },
  });
  expect(log).toEqual(["load https://x.com/compose/post"]);
});

it("refuses a post while session posting is off, before touching the page", async () => {
  const log: Array<string> = [];
  const run = commandRunner({
    ...composer(log),
    navigate: () => {},
    nextCreatedPost: async () => "1",
    sessionPostingEnabled: async () => false,
  });
  await expect(run(post("hi"))).rejects.toMatchObject({
    message: "session posting is off in Settings",
    notAttempted: true,
  });
  expect(log).toEqual([]);
});

it("tells a composer that never drew its text box from one that failed after typing", async () => {
  vi.useFakeTimers();
  const log: Array<string> = [];
  const page = composer(log);
  let drawn = false;
  const run = commandRunner({
    contents: page.contents,
    // X's page loaded, but its compose modal only shows up for the second post.
    cdp: (method, params = {}) =>
      method === "DOM.querySelectorAll" && !drawn
        ? Promise.resolve({ nodeIds: [] })
        : page.cdp(method, params),
    navigate: () => {},
    // X never confirms, so the post that was typed and sent may be on X or not.
    nextCreatedPost: () => new Promise(() => {}),
    sessionPostingEnabled: async () => true,
  });

  const blank = run(post("first")).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await blank).toMatchObject({
    message: 'composer element not ready: div[data-testid="tweetTextarea_0"]',
    notAttempted: true,
  });

  drawn = true;
  const unconfirmed = run(post("second")).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(15_000);
  const error = await unconfirmed;
  expect(error).toMatchObject({ message: "x.com did not confirm the post" });
  expect(error).not.toHaveProperty("notAttempted");
  expect(log.filter((l) => !l.startsWith("load"))).toEqual(["type second", "press Post"]);
});

it("acknowledges saving and success, and permits retry after a disconnected or failed save", async () => {
  const post: XPost = {
    postId: "20",
    url: "https://x.com/jack/status/20",
    text: "hello",
    createdAt: "2026-10-23T00:00:00Z",
    lang: "en",
    isReply: false,
    isRepost: false,
    hasMedia: false,
    hasLink: false,
    author: {
      userId: "1",
      handle: "jack",
      name: "Jack",
      followers: 500,
      verified: false,
      avatarUrl: null,
    },
    metrics: { views: 1000, likes: 2, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  };
  const statuses: Array<OverlaySave> = [];
  let finish = () => {};
  let connected = false;
  const write = vi.fn(async () => {
    if (!connected) throw new Error("Service not connected");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const save = overlaySaver({ save: write, acknowledge: (status) => statuses.push(status) });
  save(post);
  await expect.poll(() => statuses.at(-1)?.state).toBe("failed");
  connected = true;
  save(post);
  save(post);
  expect(write).toHaveBeenCalledTimes(2);
  expect(statuses.at(-1)?.state).toBe("saving");
  finish();
  await expect.poll(() => statuses.at(-1)?.state).toBe("saved");
  expect(statuses.map((status) => status.state)).toEqual(["saving", "failed", "saving", "saved"]);
  expect(statuses.every((status) => status.postId === "20")).toBe(true);
});

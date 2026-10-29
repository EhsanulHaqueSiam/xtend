import { DESKTOP_COMMAND_LIMIT_MS } from "@xtend/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  commandRunner,
  dmThroughComposer,
  likeOnPage,
  postThroughComposer,
} from "./DesktopCommands.ts";

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

it("likes the post's own article on its page, waits for X to show it liked, and skips a liked one", async () => {
  const article = 'article:has(a[href$="/status/9"] time)';
  const either = `${article} button[data-testid="like"], ${article} button[data-testid="unlike"]`;
  const presses: Array<string> = [];
  const page = (likedAlready: boolean) => {
    let liked = likedAlready;
    return async (method: string, params: Record<string, unknown> = {}) => {
      switch (method) {
        case "DOM.getDocument":
          return { root: { nodeId: 1 } };
        case "DOM.querySelectorAll":
          if (params.selector === either) return { nodeIds: [5] };
          if (params.selector === `${article} button[data-testid="unlike"]`)
            return { nodeIds: liked ? [5] : [] };
          throw new Error(`unexpected selector ${String(params.selector)}`);
        case "DOM.getAttributes":
          return { attributes: ["data-testid", liked ? "unlike" : "like"] };
        case "DOM.getBoxModel":
          return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } };
        case "Input.dispatchMouseEvent":
          if (params.type === "mouseReleased") {
            presses.push("like");
            liked = true;
          }
          return {};
        default:
          throw new Error(`unexpected ${method}`);
      }
    };
  };
  const loaded: Array<string> = [];
  const contents = { loadURL: async (url: string) => void loaded.push(url) };

  await likeOnPage(contents, page(false), "9", Date.now() + 5_000);
  await likeOnPage(contents, page(true), "9", Date.now() + 5_000);
  expect(loaded).toEqual(["https://x.com/i/web/status/9", "https://x.com/i/web/status/9"]);
  expect(presses).toEqual(["like"]);
});

it("DMs through X's message composer, presses Send once it enables, and waits for X to clear it", async () => {
  const log: Array<string> = [];
  // Send is disabled while the composer is empty: before typing and again once X sent the message.
  let typed = "";
  const cdp = async (method: string, params: Record<string, unknown> = {}) => {
    switch (method) {
      case "DOM.getDocument":
        return { root: { nodeId: 1 } };
      case "DOM.querySelectorAll":
        if (params.selector === '[data-testid="dmComposerTextInput"]') return { nodeIds: [31] };
        if (params.selector === 'button[data-testid="dmComposerSendButton"]')
          return { nodeIds: [32] };
        throw new Error(`unexpected selector ${String(params.selector)}`);
      case "DOM.getAttributes":
        return {
          attributes: params.nodeId === 32 && typed === "" ? ["aria-disabled", "true"] : [],
        };
      case "DOM.getBoxModel":
        return {
          model: {
            content:
              params.nodeId === 32 ? [50, 0, 70, 0, 70, 20, 50, 20] : [0, 0, 20, 0, 20, 20, 0, 20],
          },
        };
      case "Input.dispatchMouseEvent":
        if (params.type === "mouseReleased") {
          // 60 is the middle of Send's box; X clears the composer once the message is sent.
          log.push(params.x === 60 ? "press Send" : "focus");
          if (params.x === 60) typed = "";
        }
        return {};
      case "Input.insertText":
        typed = String(params.text);
        log.push(`type ${typed}`);
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  };
  await dmThroughComposer(
    { loadURL: async (url) => void log.push(`load ${url}`) },
    cdp,
    { type: "sessionDm", userId: "42", text: "hey" },
    Date.now() + 5_000,
  );
  expect(log).toEqual([
    "load https://x.com/messages/compose?recipient_id=42",
    "focus",
    "type hey",
    "press Send",
  ]);
});

it("refuses a DM untouched when X's message composer never draws", async () => {
  vi.useFakeTimers();
  const log: Array<string> = [];
  const run = commandRunner({
    contents: { loadURL: async (url) => void log.push(`load ${url}`) },
    cdp: async (method) =>
      method === "DOM.getDocument" ? { root: { nodeId: 1 } } : { nodeIds: [] },
    navigate: () => {},
    nextCreatedPost: () => new Promise(() => {}),
    sessionPostingEnabled: async () => true,
  });
  const result = run({ type: "sessionDm", userId: "42", text: "hey" }).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await result).toMatchObject({ notAttempted: true });
  expect(log).toEqual(["load https://x.com/messages/compose?recipient_id=42"]);
});

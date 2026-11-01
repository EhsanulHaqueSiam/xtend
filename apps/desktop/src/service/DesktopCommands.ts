import {
  DESKTOP_COMMAND_LIMIT_MS,
  Desktop_METHODS,
  type DesktopCommand,
  type DesktopCommandResult,
  Engage_METHODS,
  Library_METHODS,
  type MarkSubject,
  type ReplyTone,
  Marks_METHODS,
  WS_METHODS,
  WS_PATH,
  WsRpcGroup,
  type XPost,
} from "@xtend/contracts";
import type * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schedule from "effect/Schedule";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";

import {
  OVERLAY_MARKS_CHANNEL,
  OVERLAY_REPLY_CHANNEL,
  OVERLAY_SAVE_CHANNEL,
  type OverlaySave,
  type OverlayReply,
} from "../ipc/channels.ts";
import { X_COMPOSER, X_REPLY_ROWS } from "../overlay/xDom.ts";

const RECONNECT_MS = 2_000;
const POLL_MS = 250;
const COMPOSER_TIMEOUT_MS = 15_000;
const CREATED_TIMEOUT_MS = 15_000;
// X draws the composer's controls with its text box; one still missing by then is not coming.
const CONTROL_TIMEOUT_MS = 5_000;

type Cdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** A refusal before the session view was touched: nothing went to X, so the service may send it again. */
class NotAttempted extends Error {
  readonly notAttempted = true;
}
const untouched = (error: unknown) =>
  new NotAttempted(error instanceof Error ? error.message : String(error));

export interface DesktopCommandsOptions {
  readonly serviceUrl: string;
  readonly serviceToken: string;
  /** Loads a URL in the session view; only x.com hosts are honoured. */
  readonly navigate: (url: string) => void;
  /** Resolves with the id of the next post the session creates (from the CreateTweet response). */
  readonly nextCreatedPost: () => Promise<string>;
  readonly log: (message: string, detail?: unknown) => void;
}

const makeClient = RpcClient.make(WsRpcGroup);
type Client = Effect.Success<typeof makeClient>;

/**
 * One RPC connection to the service, held open for as long as the window lives.
 * The service streams commands it cannot run itself (anything touching the
 * x.com session); each is answered with `desktop.completeCommand`. Nothing
 * here is retried on the x.com side: a failed post is reported, not repeated.
 */
export function attachDesktopCommands(
  contents: Electron.WebContents,
  options: DesktopCommandsOptions,
) {
  const url = new URL(WS_PATH, options.serviceUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = `?token=${encodeURIComponent(options.serviceToken)}`;

  // No transparent reconnect: a dropped socket must fail the stream so the loop
  // below subscribes again, otherwise the restarted service sees no desktop.
  const layerProtocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(Socket.layerWebSocket(url.toString())),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
  );

  let client: Client | undefined;
  const run = commandRunner({
    contents,
    cdp: (method, params) => contents.debugger.sendCommand(method, params),
    navigate: options.navigate,
    nextCreatedPost: options.nextCreatedPost,
    sessionPostingEnabled: async () => {
      if (client === undefined) throw new Error("service not connected");
      const settings = await Effect.runPromise(client[WS_METHODS.settingsGet]({}));
      return settings.sessionPostingEnabled;
    },
  });

  const serve = Effect.gen(function* () {
    const current = yield* makeClient;
    client = current;
    options.log("desktop commands connected");
    yield* current[Desktop_METHODS.subscribeCommands]({}).pipe(
      Stream.runForEach((request) =>
        Effect.promise(() =>
          run(request.command).then(
            (result) => ({ id: request.id, result, error: null }),
            (error: unknown) => {
              options.log("desktop command failed", {
                type: request.command.type,
                error: String(error),
              });
              return {
                id: request.id,
                result: null,
                error: String(error),
                notAttempted: error instanceof NotAttempted,
              };
            },
          ),
        ).pipe(
          Effect.flatMap((completion) => current[Desktop_METHODS.completeCommand](completion)),
        ),
      ),
    );
  }).pipe(
    Effect.provide(layerProtocol),
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.sync(() => options.log("desktop commands disconnected", String(error))),
    ),
    Effect.ensuring(Effect.sync(() => (client = undefined))),
    Effect.retry(Schedule.spaced(RECONNECT_MS)),
    Effect.repeat(Schedule.spaced(RECONNECT_MS)),
  );
  const fiber = Effect.runFork(serve);

  /** Asks the service what it knows about these posts and hands the marks to the overlay. */
  const marks = (posts: ReadonlyArray<MarkSubject>) => {
    if (client === undefined || posts.length === 0) return;
    void Effect.runPromise(client[Marks_METHODS.forPosts]({ posts })).then(
      (found) => contents.send(OVERLAY_MARKS_CHANNEL, found),
      (error: unknown) => options.log("marks failed", String(error)),
    );
  };

  const subject = (post: XPost) => [{ postId: post.postId, handle: post.author.handle }];
  const reply = (postId: string, outcome: Omit<OverlayReply, "postId">) =>
    contents.send(OVERLAY_REPLY_CHANNEL, { postId, ...outcome });

  return {
    marks,
    /** Three drafts in a tone for the strip's reply panel. */
    draft: (post: XPost, tone: ReplyTone) => {
      if (client === undefined) return reply(post.postId, { error: "Service not connected." });
      void Effect.runPromise(client[Engage_METHODS.draftReply]({ post, tone })).then(
        (drafts) => reply(post.postId, { drafts: drafts.map((d) => d.text) }),
        (error: unknown) => reply(post.postId, { error: String(error).slice(0, 200) }),
      );
    },
    /** The reply the user clicked; the service picks the lane and records it. */
    reply: (post: XPost, text: string) => {
      if (client === undefined) return reply(post.postId, { error: "Service not connected." });
      void Effect.runPromise(client[Engage_METHODS.reply]({ post, text })).then(
        (sent) => {
          reply(post.postId, sent.error === null ? { replied: true } : { error: sent.error });
          marks(subject(post));
        },
        (error: unknown) => reply(post.postId, { error: String(error).slice(0, 200) }),
      );
    },
    /** Saves a post to the library with its metrics frozen; the overlay's Save action. */
    save: overlaySaver({
      save: async (post) => {
        if (client === undefined) throw new Error("Service not connected");
        await Effect.runPromise(client[Library_METHODS.save]({ post, collectionId: null }));
        marks(subject(post));
      },
      acknowledge: (status) => contents.send(OVERLAY_SAVE_CHANNEL, status),
    }),
    detach: () => void Effect.runPromise(Fiber.interrupt(fiber)),
  };
}

/** A click can be retried after failure; duplicate clicks while saving are ignored. */
export function overlaySaver({
  save,
  acknowledge,
}: {
  readonly save: (post: XPost) => Promise<void>;
  readonly acknowledge: (status: OverlaySave) => void;
}) {
  const pending = new Set<string>();
  return (post: XPost) => {
    if (pending.has(post.postId)) return;
    pending.add(post.postId);
    acknowledge({ postId: post.postId, state: "saving" });
    void save(post)
      .then(
        () => acknowledge({ postId: post.postId, state: "saved" }),
        () => acknowledge({ postId: post.postId, state: "failed" }),
      )
      .finally(() => pending.delete(post.postId));
  };
}

interface CommandRunnerDeps {
  readonly contents: Pick<Electron.WebContents, "loadURL">;
  readonly cdp: Cdp;
  readonly navigate: (url: string) => void;
  readonly nextCreatedPost: () => Promise<string>;
  /** The service's setting, asked again before every post. */
  readonly sessionPostingEnabled: () => Promise<boolean>;
}

/**
 * Runs the service's commands in the session view one at a time, across reconnects too: a post
 * whose socket dropped mid-flow still owns X's composer until it ends, and the next command waits
 * for it. Each command gets DESKTOP_COMMAND_LIMIT_MS from when it arrived, waiting included, and
 * one that has none left is refused before it touches the page: the service has given up on it.
 */
export function commandRunner(deps: CommandRunnerDeps) {
  let busy: Promise<unknown> = Promise.resolve();

  const run = async (command: DesktopCommand, deadline: number): Promise<DesktopCommandResult> => {
    if (Date.now() >= deadline)
      throw new NotAttempted(`${command.type} waited out its time behind another command`);
    switch (command.type) {
      case "sessionScreenshot": {
        const shot = (await deps.cdp("Page.captureScreenshot", { format: "png" })) as {
          data: string;
        };
        return { type: "sessionScreenshot", pngBase64: shot.data };
      }
      case "sessionNavigate":
        deps.navigate(command.url);
        return { type: "sessionNavigate" };
      case "sessionPost": {
        const enabled = await deps.sessionPostingEnabled().catch((error: unknown) => {
          throw untouched(error);
        });
        if (!enabled) throw new NotAttempted("session posting is off in Settings");
        const postId = await postThroughComposer(
          deps.contents,
          deps.cdp,
          command,
          deps.nextCreatedPost,
          deadline,
        );
        return { type: "sessionPost", postId };
      }
      case "sessionLike": {
        const enabled = await deps.sessionPostingEnabled().catch((error: unknown) => {
          throw untouched(error);
        });
        if (!enabled) throw new NotAttempted("session posting is off in Settings");
        await likeOnPage(deps.contents, deps.cdp, command.postId, deadline);
        return { type: "sessionLike" };
      }
      case "sessionDm": {
        const enabled = await deps.sessionPostingEnabled().catch((error: unknown) => {
          throw untouched(error);
        });
        if (!enabled) throw new NotAttempted("session posting is off in Settings");
        await dmThroughComposer(deps.contents, deps.cdp, command, deadline);
        return { type: "sessionDm" };
      }
    }
  };

  return (command: DesktopCommand): Promise<DesktopCommandResult> => {
    const deadline = Date.now() + DESKTOP_COMMAND_LIMIT_MS[command.type];
    const result = busy.then(() => run(command, deadline));
    busy = result.catch(() => {});
    return result;
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `promise`, or `message` as an error once the deadline passes. */
const until = <A>(promise: Promise<A>, deadline: number, message: string): Promise<A> =>
  Promise.race([
    promise,
    sleep(deadline - Date.now()).then(() => {
      throw new Error(message);
    }),
  ]);

const attributes = async (cdp: Cdp, nodeId: number): Promise<Record<string, string>> => {
  const { attributes: flat } = (await cdp("DOM.getAttributes", { nodeId })) as {
    attributes: Array<string>;
  };
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]!] = flat[i + 1] ?? "";
  return out;
};

/**
 * Polls for a selector until it matches (and `ready` agrees) or the deadline passes. The last
 * match wins: X draws the compose modal in its layers root, after the page's own inline
 * composer, which carries the same test ids.
 */
async function waitForNode(
  cdp: Cdp,
  selector: string,
  deadline: number,
  ready: (attrs: Record<string, string>) => boolean = () => true,
): Promise<number> {
  // Checked first, so a flow that outlived its command never acts on what it finds.
  if (Date.now() >= deadline) throw new Error(`composer element not ready: ${selector}`);
  const { root } = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const { nodeIds } = (await cdp("DOM.querySelectorAll", { nodeId: root.nodeId, selector })) as {
    nodeIds: Array<number>;
  };
  const nodeId = nodeIds.at(-1);
  if (nodeId !== undefined && ready(await attributes(cdp, nodeId))) return nodeId;
  await sleep(POLL_MS);
  return waitForNode(cdp, selector, deadline, ready);
}

async function click(cdp: Cdp, nodeId: number): Promise<void> {
  const { model } = (await cdp("DOM.getBoxModel", { nodeId })) as {
    model: { content: Array<number> };
  };
  const [x1, y1, , , x2, y2] = model.content as [number, number, number, number, number, number];
  const x = (x1 + x2) / 2;
  const y = (y1 + y2) / 2;
  const press = (type: string) =>
    cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await press("mousePressed");
  await press("mouseReleased");
}

const enabled = (attrs: Record<string, string>) =>
  attrs["aria-disabled"] !== "true" && !("disabled" in attrs);

/** Like `waitForNode`, for rows X marks only by their text: the last match whose text is `text`. */
async function waitForText(
  cdp: Cdp,
  selector: string,
  text: string,
  deadline: number,
): Promise<number> {
  if (Date.now() >= deadline) throw new Error(`composer element not ready: ${selector} ${text}`);
  const { root } = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const { nodeIds } = (await cdp("DOM.querySelectorAll", { nodeId: root.nodeId, selector })) as {
    nodeIds: Array<number>;
  };
  for (const nodeId of nodeIds.toReversed()) {
    const { outerHTML } = (await cdp("DOM.getOuterHTML", { nodeId })) as { outerHTML: string };
    // Exact: "Accounts you follow" is also the start of another row.
    if (
      outerHTML
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim() === text
    )
      return nodeId;
  }
  await sleep(POLL_MS);
  return waitForText(cdp, selector, text, deadline);
}

/** Resolves once nothing matches `selector`; fails at `deadline` (now: a single check). */
async function waitForGone(cdp: Cdp, selector: string, deadline: number): Promise<void> {
  const { root } = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const { nodeIds } = (await cdp("DOM.querySelectorAll", { nodeId: root.nodeId, selector })) as {
    nodeIds: Array<number>;
  };
  if (nodeIds.length === 0) return;
  if (Date.now() >= deadline) throw new Error(`composer element still there: ${selector}`);
  await sleep(POLL_MS);
  return waitForGone(cdp, selector, deadline);
}

// React keeps a select's value itself: the native setter plus a change event is what a pick does.
const PICK = `function (value) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(this, value);
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return this.value === value;
}`;

/** Picks `value` in a select; false when it has no such option. */
async function pick(cdp: Cdp, nodeId: number, value: string): Promise<boolean> {
  const { object } = (await cdp("DOM.resolveNode", { nodeId })) as {
    object: { objectId: string };
  };
  const { result } = (await cdp("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: PICK,
    arguments: [{ value }],
    returnByValue: true,
  })) as { result: { value: unknown } };
  return result.value === true;
}

const missing = (what: string) =>
  new NotAttempted(`x.com's composer has no ${what}; nothing was posted`);

/**
 * Sets the poll and who can reply in X's own composer, before any text goes in, so a control X
 * no longer draws refuses the post untouched instead of posting it without the user's choice.
 * Returns the reply button's label X must show at Post, or null for X's default.
 */
async function setComposerOptions(
  cdp: Cdp,
  command: Extract<DesktopCommand, { type: "sessionPost" }>,
  deadline: number,
): Promise<string | null> {
  const step = () => Math.min(Date.now() + CONTROL_TIMEOUT_MS, deadline);
  const control = (selector: string, what: string) =>
    waitForNode(cdp, selector, step()).catch(() => {
      throw missing(what);
    });
  const { poll, replySettings } = command;
  if (poll !== undefined) {
    await click(cdp, await control(X_COMPOSER.addPoll, "Add poll"));
    for (const [i, option] of poll.options.entries()) {
      if (i >= 2) await click(cdp, await control(X_COMPOSER.addChoice, "Add a choice"));
      await click(cdp, await control(X_COMPOSER.choice(i + 1), `poll choice ${i + 1}`));
      await cdp("Input.insertText", { text: option });
    }
    const m = poll.durationMinutes;
    const length = [
      [X_COMPOSER.pollDays, Math.floor(m / 1440), "days"],
      [X_COMPOSER.pollHours, Math.floor((m % 1440) / 60), "hours"],
      [X_COMPOSER.pollMinutes, m % 60, "minutes"],
    ] as const;
    for (const [selector, value, unit] of length)
      if (!(await pick(cdp, await control(selector, `poll ${unit}`), String(value))))
        throw missing(`${value} poll ${unit}`);
  }
  if (replySettings === undefined || replySettings === "everyone") return null;
  const { row, label } = X_REPLY_ROWS[replySettings];
  await click(cdp, await control(X_COMPOSER.replyButton, "Everyone can reply"));
  const rowNode = await waitForText(cdp, X_COMPOSER.replyRow, row, step()).catch(() => {
    throw missing(`"${row}" row`);
  });
  await click(cdp, rowNode);
  // X names the setting on its button once it took; any other name and the post must not go.
  await control(X_COMPOSER.replyButtonFor(label), `"${label}"`);
  return label;
}

/**
 * Types into x.com's own composer exactly as a user would: set the poll and who can reply,
 * focus, insert text, pick files through the hidden input, press Post. The id comes from the
 * CreateTweet response the capture sees, not from any guess. Every step ends by `deadline`;
 * the upload alone may take whatever is left of it.
 */
export async function postThroughComposer(
  contents: Pick<Electron.WebContents, "loadURL">,
  cdp: Cdp,
  command: Extract<DesktopCommand, { type: "sessionPost" }>,
  nextCreatedPost: () => Promise<string>,
  deadline: number,
): Promise<string> {
  const step = (ms: number) => Math.min(Date.now() + ms, deadline);
  // Until the first keystroke a failure leaves nothing that could become a post.
  const textbox = 'div[data-testid="tweetTextarea_0"]';
  await until(
    contents.loadURL(
      command.replyToPostId === undefined
        ? "https://x.com/compose/post"
        : `https://x.com/intent/post?in_reply_to=${command.replyToPostId}`,
    ),
    deadline,
    "x.com's composer did not load",
  )
    .then(() => waitForNode(cdp, textbox, step(COMPOSER_TIMEOUT_MS)))
    .catch((error: unknown) => {
      throw untouched(error);
    });
  const replyLabel = await setComposerOptions(cdp, command, deadline);
  // Found again: adding a poll redraws the composer around its text box. The press into it is
  // also the press outside X's reply popover, which stays open after a pick until then.
  await click(cdp, await waitForNode(cdp, textbox, step(COMPOSER_TIMEOUT_MS)));
  await waitForGone(cdp, X_COMPOSER.replyPopover, step(CONTROL_TIMEOUT_MS)).catch(() => {
    throw new NotAttempted("x.com's reply settings stayed open; nothing was posted");
  });
  await cdp("Input.insertText", { text: command.text });
  if (command.mediaPaths.length > 0) {
    const input = await waitForNode(
      cdp,
      'input[data-testid="fileInput"]',
      step(COMPOSER_TIMEOUT_MS),
    );
    await cdp("DOM.setFileInputFiles", { nodeId: input, files: command.mediaPaths });
  }
  // The post button stays disabled while uploads run.
  const created = nextCreatedPost();
  const button = await waitForNode(cdp, 'button[data-testid="tweetButton"]', deadline, enabled);
  // Checked again at the press: still closed, and X still names the user's setting.
  await waitForGone(cdp, X_COMPOSER.replyPopover, Date.now()).catch(() => {
    throw new NotAttempted("x.com's reply settings opened again; nothing was posted");
  });
  if (replyLabel !== null)
    await waitForNode(cdp, X_COMPOSER.replyButtonFor(replyLabel), step(CONTROL_TIMEOUT_MS)).catch(
      () => {
        throw missing(`"${replyLabel}"`);
      },
    );
  await click(cdp, button);
  return until(created, step(CREATED_TIMEOUT_MS), "x.com did not confirm the post");
}

/**
 * Likes a post as the user would: opens its page and presses X's own like on that post, then
 * waits for X to show it as liked. A post already liked is left alone. The post's own article is
 * the one whose timestamp links to it; a thread's parents above it link elsewhere.
 */
export async function likeOnPage(
  contents: Pick<Electron.WebContents, "loadURL">,
  cdp: Cdp,
  postId: string,
  deadline: number,
): Promise<void> {
  const step = (ms: number) => Math.min(Date.now() + ms, deadline);
  const article = `article:has(a[href$="/status/${postId}"] time)`;
  const button = await until(
    contents.loadURL(`https://x.com/i/web/status/${postId}`),
    deadline,
    "x.com did not load the post",
  )
    .then(() =>
      waitForNode(
        cdp,
        `${article} button[data-testid="like"], ${article} button[data-testid="unlike"]`,
        step(COMPOSER_TIMEOUT_MS),
      ),
    )
    .catch((error: unknown) => {
      throw untouched(error);
    });
  if ((await attributes(cdp, button))["data-testid"] === "unlike") return;
  await click(cdp, button);
  await waitForNode(cdp, `${article} button[data-testid="unlike"]`, step(CREATED_TIMEOUT_MS)).catch(
    () => {
      throw new Error("x.com did not show the post as liked");
    },
  );
}

/**
 * Sends a DM as the user would: opens X's message composer for the recipient, types and presses
 * Send, then waits for X to clear the composer, which it does once the message is sent and which
 * shows as Send turning disabled again.
 */
export async function dmThroughComposer(
  contents: Pick<Electron.WebContents, "loadURL">,
  cdp: Cdp,
  command: Extract<DesktopCommand, { type: "sessionDm" }>,
  deadline: number,
): Promise<void> {
  const step = (ms: number) => Math.min(Date.now() + ms, deadline);
  const send = 'button[data-testid="dmComposerSendButton"]';
  const input = await until(
    contents.loadURL(`https://x.com/messages/compose?recipient_id=${command.userId}`),
    deadline,
    "x.com's message composer did not load",
  )
    .then(() => waitForNode(cdp, '[data-testid="dmComposerTextInput"]', step(COMPOSER_TIMEOUT_MS)))
    .catch((error: unknown) => {
      throw untouched(error);
    });
  await click(cdp, input);
  await cdp("Input.insertText", { text: command.text });
  await click(cdp, await waitForNode(cdp, send, step(COMPOSER_TIMEOUT_MS), enabled));
  await waitForNode(cdp, send, step(CREATED_TIMEOUT_MS), (attrs) => !enabled(attrs)).catch(() => {
    throw new Error("x.com did not confirm the message");
  });
}

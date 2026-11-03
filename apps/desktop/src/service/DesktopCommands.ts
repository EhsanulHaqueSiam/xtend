import {
  DESKTOP_COMMAND_LIMIT_MS,
  Desktop_METHODS,
  type DesktopCommand,
  type DesktopCommandResult,
  Engage_METHODS,
  Library_METHODS,
  type MarkSubject,
  type PickedGif,
  type ReplyTone,
  type TextStyle,
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

/** A refusal before Post was pressed: nothing went to X, so the service may send it again. */
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

/** Every node matching `selector`, in document order. */
async function query(cdp: Cdp, selector: string): Promise<Array<number>> {
  const { root } = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const { nodeIds } = (await cdp("DOM.querySelectorAll", { nodeId: root.nodeId, selector })) as {
    nodeIds: Array<number>;
  };
  return nodeIds;
}

const textOf = async (cdp: Cdp, nodeId: number) => {
  const { outerHTML } = (await cdp("DOM.getOuterHTML", { nodeId })) as { outerHTML: string };
  return outerHTML
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\u200b]+/g, " ")
    .trim();
};

/** Like `waitForNode`, for rows X marks only by their text: the last match whose text is `text`. */
async function waitForText(
  cdp: Cdp,
  selector: string,
  text: string,
  deadline: number,
): Promise<number> {
  if (Date.now() >= deadline) throw new Error(`composer element not ready: ${selector} ${text}`);
  // Exact: "Accounts you follow" is also the start of another row.
  for (const nodeId of (await query(cdp, selector)).toReversed())
    if ((await textOf(cdp, nodeId)) === text) return nodeId;
  await sleep(POLL_MS);
  return waitForText(cdp, selector, text, deadline);
}

/** Resolves once nothing matches `selector`; fails at `deadline` (now: a single check). */
async function waitForGone(cdp: Cdp, selector: string, deadline: number): Promise<void> {
  if ((await query(cdp, selector)).length === 0) return;
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

// React keeps an input's value too: the native setter plus an input event is what typing does.
const FILL = `function (value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(this, value);
  this.dispatchEvent(new Event("input", { bubbles: true }));
  return this.value === value;
}`;
const BACKGROUND = `function () { return getComputedStyle(this).backgroundImage; }`;

const objectOf = async (cdp: Cdp, nodeId: number) =>
  ((await cdp("DOM.resolveNode", { nodeId })) as { object: { objectId: string } }).object.objectId;

/** What `declaration` returns, run on the node with `value`. */
async function callOn(cdp: Cdp, nodeId: number, declaration: string, value?: string) {
  const { result } = (await cdp("Runtime.callFunctionOn", {
    objectId: await objectOf(cdp, nodeId),
    functionDeclaration: declaration,
    arguments: [{ value }],
    returnByValue: true,
  })) as { result: { value: unknown } };
  return result.value;
}

const NEAREST_BACK = `function () {
  for (let n = this.parentElement; n !== null; n = n.parentElement) {
    const back = n.querySelector(${JSON.stringify(X_COMPOSER.gifBack)});
    if (back !== null) return back;
  }
  return null;
}`;

// Where X's GIF search is: its URL and query while X is on its route, else null.
const GIF_WHERE = `location.pathname === ${JSON.stringify(X_COMPOSER.gifRoute)} ? location.href + "\\n" + (document.querySelector(${JSON.stringify(X_COMPOSER.gifSearch)})?.value ?? "") : null`;
// Enough Backs for the queries X's search holds, each a history entry of its own.
const GIF_BACKS = 20;

const gifWhere = async (cdp: Cdp) => {
  const { result } = (await cdp("Runtime.evaluate", {
    expression: GIF_WHERE,
    returnByValue: true,
  })) as { result: { value: unknown } };
  return typeof result.value === "string" ? result.value : null;
};

/**
 * Leaves X's GIF search with its own Back, one history entry at a time: only while X is on the
 * search's route, and each press only once X took the one before (its URL or query moved).
 */
async function leaveGifSearch(cdp: Cdp): Promise<void> {
  for (let press = 0; press < GIF_BACKS; press++) {
    const at = await gifWhere(cdp);
    if (at === null) return;
    const [field] = (await query(cdp, X_COMPOSER.gifSearch)).toReversed();
    if (field === undefined) throw new Error("x.com's GIF search has no field");
    await click(cdp, await gifBack(cdp, field));
    const deadline = Date.now() + CONTROL_TIMEOUT_MS;
    while ((await gifWhere(cdp)) === at) {
      if (Date.now() >= deadline) throw new Error("x.com did not take its GIF search's Back");
      await sleep(POLL_MS);
    }
  }
  if ((await gifWhere(cdp)) !== null) throw new Error("x.com's GIF search stayed open");
}

/** X's Back for its GIF search, found from the search's field (see `X_COMPOSER.gifBack`). */
async function gifBack(cdp: Cdp, field: number): Promise<number> {
  const { result } = (await cdp("Runtime.callFunctionOn", {
    objectId: await objectOf(cdp, field),
    functionDeclaration: NEAREST_BACK,
    returnByValue: false,
  })) as { result: { objectId?: string } };
  if (result.objectId === undefined) throw new Error("x.com's GIF search has no Back");
  const { nodeId } = (await cdp("DOM.requestNode", { objectId: result.objectId })) as {
    nodeId: number;
  };
  return nodeId;
}

/** Picks `value` in a select; false when it has no such option. */
const pick = async (cdp: Cdp, nodeId: number, value: string) =>
  (await callOn(cdp, nodeId, PICK, value)) === true;

const TEXTBOX = 'div[data-testid="tweetTextarea_0"]';

const missing = (what: string) =>
  new NotAttempted(`x.com's composer has no ${what}; nothing was posted`);

/** A composer control, or the refusal that names it once CONTROL_TIMEOUT_MS (or `deadline`) passes. */
const control = (cdp: Cdp, selector: string, what: string, deadline = Infinity) =>
  waitForNode(cdp, selector, Math.min(Date.now() + CONTROL_TIMEOUT_MS, deadline)).catch(() => {
    throw missing(what);
  });

/**
 * Picks `row` in X's reply popover opened from `button`, waits for X to name it `label`, and
 * closes the popover, which stays open after a pick, by pressing into the text box.
 */
async function pickReply(
  cdp: Cdp,
  { button, row, label }: { button: string; row: string; label: string },
  deadline: number,
  picked: () => void = () => {},
): Promise<void> {
  await click(cdp, await control(cdp, button, "reply setting", deadline));
  const rowNode = await waitForText(
    cdp,
    X_COMPOSER.replyRow,
    row,
    Math.min(Date.now() + CONTROL_TIMEOUT_MS, deadline),
  ).catch(() => {
    throw missing(`"${row}" row`);
  });
  picked();
  await click(cdp, rowNode);
  // X names the setting on its button once it took; any other name and the post must not go.
  await control(cdp, X_COMPOSER.replyButtonFor(label), `"${label}"`, deadline);
  await click(cdp, await control(cdp, TEXTBOX, "text box", deadline));
  await waitForGone(
    cdp,
    X_COMPOSER.replyPopover,
    Math.min(Date.now() + CONTROL_TIMEOUT_MS, deadline),
  ).catch(() => {
    throw new NotAttempted("x.com's reply settings stayed open; nothing was posted");
  });
}

/** Fills X's poll: its choices, then its length as days, hours and minutes. */
async function fillPoll(
  cdp: Cdp,
  poll: NonNullable<Extract<DesktopCommand, { type: "sessionPost" }>["poll"]>,
  deadline: number,
  added: () => void,
): Promise<void> {
  await click(cdp, await control(cdp, X_COMPOSER.addPoll, "Add poll", deadline));
  added();
  for (const [i, option] of poll.options.entries()) {
    if (i >= 2)
      await click(cdp, await control(cdp, X_COMPOSER.addChoice, "Add a choice", deadline));
    await click(
      cdp,
      await control(cdp, X_COMPOSER.choice(i + 1), `poll choice ${i + 1}`, deadline),
    );
    await cdp("Input.insertText", { text: option });
  }
  const m = poll.durationMinutes;
  const length = [
    [X_COMPOSER.pollDays, Math.floor(m / 1440), "days"],
    [X_COMPOSER.pollHours, Math.floor((m % 1440) / 60), "hours"],
    [X_COMPOSER.pollMinutes, m % 60, "minutes"],
  ] as const;
  for (const [selector, value, unit] of length)
    if (!(await pick(cdp, await control(cdp, selector, `poll ${unit}`, deadline), String(value))))
      throw missing(`${value} poll ${unit}`);
}

/** X's GIF tile whose picture's URL holds `path`; scrolling X's list on makes X load its next page. */
async function findTile(cdp: Cdp, path: string, deadline: number): Promise<number> {
  if (Date.now() >= deadline) throw new Error(`no GIF tile ${path}`);
  const tiles = await query(cdp, X_COMPOSER.gifTile);
  for (const tile of tiles)
    if (String(await callOn(cdp, tile, BACKGROUND)).includes(path)) return tile;
  const last = tiles.at(-1);
  if (last !== undefined) await cdp("DOM.scrollIntoViewIfNeeded", { nodeId: last });
  await sleep(POLL_MS);
  return findTile(cdp, path, deadline);
}

/**
 * Attaches the GIF the user picked as X's own picker does: X's GIF search opened from the
 * composer, the query typed, the tile with the same id pressed, and X back in the composer with it.
 */
async function pickGif(
  cdp: Cdp,
  gif: PickedGif,
  deadline: number,
  picked: () => void,
): Promise<void> {
  await click(cdp, await control(cdp, X_COMPOSER.gifButton, "Add a GIF", deadline));
  const field = await control(cdp, X_COMPOSER.gifSearch, "GIF search", deadline);
  if ((await callOn(cdp, field, FILL, gif.query)) !== true) throw missing("GIF search field");
  // X's id is the provider's behind X's prefix (giphy_<id>), and the preview's URL holds it.
  const path = `/${gif.id.replace(/^[a-z]+_/, "")}/`;
  const tile = await findTile(
    cdp,
    path,
    Math.min(Date.now() + COMPOSER_TIMEOUT_MS, deadline),
  ).catch(() => {
    throw missing(`GIF "${gif.id}" in its search for "${gif.query}"`);
  });
  await cdp("DOM.scrollIntoViewIfNeeded", { nodeId: tile });
  picked();
  await click(cdp, tile);
  // Without the GIF in the composer, Post would send the text alone.
  await control(cdp, X_COMPOSER.removeMedia, "picked GIF", deadline);
  await waitForGone(
    cdp,
    X_COMPOSER.gifSearch,
    Math.min(Date.now() + CONTROL_TIMEOUT_MS, deadline),
  ).catch(() => {
    throw new NotAttempted("x.com's GIF search stayed open; nothing was posted");
  });
}

// X's composer (Draft.js) reads ⌘ as the command key when its user agent says Mac, Ctrl elsewhere.
const ON_MAC = "/Mac OS X/.test(navigator.userAgent)";
const STYLE_KEYS = { Bold: ["b", "KeyB", 66], Italic: ["i", "KeyI", 73] } as const;
// X's editor as drawn: its text without line breaks and, per character, "1" where X draws it
// bold (or italic), read from each text's own leaf (X's styled span).
const EDITOR_TEXT = `function () {
  let text = "", Bold = "", Italic = "";
  const walk = document.createTreeWalker(this, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
    // An editable page keeps a typed space before a run as a no-break space; it reads the same.
    const t = n.textContent.replace(/[\\r\\n]/g, "").replace(/\\u00a0/g, " ");
    const style = getComputedStyle(n.parentElement.closest("[data-offset-key]") ?? n.parentElement);
    text += t;
    Bold += (Number(style.fontWeight) >= 600 ? "1" : "0").repeat(t.length);
    Italic += (style.fontStyle === "italic" ? "1" : "0").repeat(t.length);
  }
  return JSON.stringify({ text, Bold, Italic });
}`;
// X never styles a mention, hashtag, cashtag or link, so their characters are X's to draw.
const ENTITY = /[@#$][\p{L}\p{N}_]+|https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?/giu;

/** What X's editor must show for `text`: its text without line breaks and each style's marks. */
function expectedEditor(text: string, styles: ReadonlyArray<TextStyle>) {
  const free = new Set<number>();
  for (const m of text.matchAll(ENTITY))
    for (let i = m.index; i < m.index + m[0].length; i++) free.add(i);
  const want = { text: "", Bold: "", Italic: "" };
  // UTF-16 units, as the runs and X's editor count them.
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n" || text[i] === "\r") continue;
    want.text += text[i];
    for (const style of ["Bold", "Italic"] as const) {
      const on = styles.some((s) => s.style === style && s.start <= i && i < s.end);
      want[style] += free.has(i) ? "?" : on ? "1" : "0";
    }
  }
  return want;
}

/**
 * Types the text into X's text box `box` as its user formats it: X's own ⌘B and ⌘I pressed where
 * a run of bold or italic starts and ends. X applies them only for an account it lets format, so
 * the post is refused unless X's editor shows the text styled exactly as asked.
 */
async function typeText(
  cdp: Cdp,
  box: number,
  text: string,
  styles: ReadonlyArray<TextStyle>,
): Promise<void> {
  if (styles.length === 0) return void (await cdp("Input.insertText", { text }));
  const { result } = (await cdp("Runtime.evaluate", {
    expression: ON_MAC,
    returnByValue: true,
  })) as { result: { value: unknown } };
  const modifiers = result.value === true ? 4 : 2;
  const cuts = [...new Set([0, text.length, ...styles.flatMap((s) => [s.start, s.end])])]
    .filter((i) => i <= text.length)
    .toSorted((a, b) => a - b);
  const on = { Bold: false, Italic: false };
  for (const [k, end] of cuts.slice(1).entries()) {
    const start = cuts[k]!;
    for (const style of ["Bold", "Italic"] as const) {
      const wanted = styles.some((s) => s.style === style && s.start <= start && s.end >= end);
      if (wanted === on[style]) continue;
      on[style] = wanted;
      const [key, code, windowsVirtualKeyCode] = STYLE_KEYS[style];
      for (const type of ["rawKeyDown", "keyUp"] as const)
        await cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode, modifiers });
    }
    await cdp("Input.insertText", { text: text.slice(start, end) });
  }
  // Every run and every plain gap, as asked: a toggle X missed would post the wrong words styled.
  const shown = JSON.parse(String(await callOn(cdp, box, EDITOR_TEXT))) as Record<string, string>;
  const want = expectedEditor(text, styles);
  const same = (style: "Bold" | "Italic") =>
    shown[style]?.length === want[style].length &&
    [...want[style]].every((c, i) => c === "?" || c === shown[style]![i]);
  if (shown.text !== want.text || !same("Bold") || !same("Italic"))
    throw new Error("x.com's composer did not format the text as asked");
}

/** What the driver put in X's composer, so a refusal before Post can take it back out. */
interface Touched {
  reply: boolean;
  poll: boolean;
  media: boolean;
  text: boolean;
}

/**
 * Takes back out of X's composer what the driver put in, after a failure before Post: X's GIF
 * search left, the reply setting back to Everyone, the poll and media removed, the text cleared. Never presses
 * Post or a draft dialog. The refusal names what may still be there.
 */
async function takeBack(cdp: Cdp, touched: Touched, error: unknown): Promise<NotAttempted> {
  const left: Array<string> = [];
  const undo = (what: string, run: () => Promise<unknown>) =>
    run().catch(() => void left.push(what));
  const soon = () => Date.now() + CONTROL_TIMEOUT_MS;
  // An open popover would take the presses below.
  await undo("an open reply popover", async () => {
    if ((await query(cdp, X_COMPOSER.replyPopover)).length === 0) return;
    await click(cdp, await control(cdp, TEXTBOX, "text box"));
    await waitForGone(cdp, X_COMPOSER.replyPopover, soon());
  });
  // So would X's GIF search, open over the composer.
  await undo("X's GIF search", () => leaveGifSearch(cdp));
  if (touched.reply)
    await undo("the reply setting", () =>
      pickReply(
        cdp,
        {
          button: X_COMPOSER.anyReplyButton,
          row: "Everyone",
          label: "Everyone can reply",
        },
        Infinity,
      ),
    );
  if (touched.poll)
    await undo("the poll", async () => {
      await click(cdp, await control(cdp, X_COMPOSER.removePoll, "Remove poll"));
      await waitForGone(cdp, X_COMPOSER.choice(1), soon());
    });
  if (touched.media)
    await undo("the media", async () => {
      // One press per attachment, at most four of them.
      for (let i = 0; i < 4; i++) {
        const [last] = (await query(cdp, X_COMPOSER.removeMedia)).toReversed();
        if (last === undefined) break;
        await click(cdp, last);
      }
      await waitForGone(cdp, X_COMPOSER.removeMedia, soon());
    });
  if (touched.text)
    await undo("the text", async () => {
      const box = await control(cdp, TEXTBOX, "text box");
      await click(cdp, box);
      // Chromium's own selectAll command, so no platform chord; then one Backspace clears it.
      for (const [key, code, keyCode, commands] of [
        ["a", "KeyA", 65, ["selectAll"]],
        ["Backspace", "Backspace", 8, []],
      ] as const) {
        await cdp("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key,
          code,
          windowsVirtualKeyCode: keyCode,
          commands,
        });
        await cdp("Input.dispatchKeyEvent", {
          type: "keyUp",
          key,
          code,
          windowsVirtualKeyCode: keyCode,
        });
      }
      if ((await textOf(cdp, box)) !== "") throw new Error("text left");
    });
  // Post was never pressed: nothing went to X, whatever stopped it.
  const said = error instanceof Error ? error.message : String(error);
  const message = said.endsWith("nothing was posted") ? said : `${said}; nothing was posted`;
  return new NotAttempted(
    left.length === 0 ? message : `${message}; X's composer may still hold ${left.join(", ")}`,
  );
}

/**
 * Uses x.com's own composer as a user would: who can reply, the poll or the GIF, the text with
 * its bold and italic, the files, Post. The id comes from X's create response the capture sees.
 * Every step ends by `deadline`; the upload may take what is left. A failure before Post takes
 * back out what was put in.
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
  await until(
    contents.loadURL(
      command.replyToPostId === undefined
        ? "https://x.com/compose/post"
        : `https://x.com/intent/post?in_reply_to=${command.replyToPostId}`,
    ),
    deadline,
    "x.com's composer did not load",
  )
    .then(() => waitForNode(cdp, TEXTBOX, step(COMPOSER_TIMEOUT_MS)))
    .catch((error: unknown) => {
      throw untouched(error);
    });
  const touched: Touched = { reply: false, poll: false, media: false, text: false };
  const { replySettings, poll } = command;
  const reply =
    replySettings === undefined || replySettings === "everyone"
      ? null
      : { button: X_COMPOSER.replyButton, ...X_REPLY_ROWS[replySettings] };
  const ready = async () => {
    // Who can reply first: a control X no longer draws then refuses before anything is filled.
    if (reply !== null) await pickReply(cdp, reply, deadline, () => (touched.reply = true));
    if (poll !== undefined) await fillPoll(cdp, poll, deadline, () => (touched.poll = true));
    if (command.gif !== undefined)
      await pickGif(cdp, command.gif, deadline, () => (touched.media = true));
    // Found again: adding a poll redraws the composer around its text box.
    const box = await waitForNode(cdp, TEXTBOX, step(COMPOSER_TIMEOUT_MS));
    await click(cdp, box);
    touched.text = command.text !== "";
    await typeText(cdp, box, command.text, command.styles ?? []);
    if (command.mediaPaths.length > 0) {
      const input = await waitForNode(
        cdp,
        'input[data-testid="fileInput"]',
        step(COMPOSER_TIMEOUT_MS),
      );
      touched.media = true;
      await cdp("DOM.setFileInputFiles", { nodeId: input, files: command.mediaPaths });
    }
    // Listening before Post; the button stays disabled while uploads run.
    const created = nextCreatedPost();
    const post = 'button[data-testid="tweetButton"]';
    await waitForNode(cdp, post, deadline, enabled);
    // Checked again at the press: still closed, and X still names the user's setting.
    await waitForGone(cdp, X_COMPOSER.replyPopover, Date.now()).catch(() => {
      throw new NotAttempted("x.com's reply settings opened again; nothing was posted");
    });
    if (reply !== null)
      await control(cdp, X_COMPOSER.replyButtonFor(reply.label), `"${reply.label}"`, deadline);
    // Found last: each lookup above drops the node ids Chromium handed out before it.
    return { button: await waitForNode(cdp, post, deadline, enabled), created };
  };
  const { button, created } = await ready().catch(async (error: unknown) => {
    throw await takeBack(cdp, touched, error);
  });
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

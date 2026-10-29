import {
  DESKTOP_COMMAND_LIMIT_MS,
  Desktop_METHODS,
  type DesktopCommand,
  type DesktopCommandResult,
  Library_METHODS,
  type MarkSubject,
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

import { OVERLAY_MARKS_CHANNEL } from "../ipc/channels.ts";

const RECONNECT_MS = 2_000;
const POLL_MS = 250;
const COMPOSER_TIMEOUT_MS = 15_000;
const CREATED_TIMEOUT_MS = 15_000;

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

  return {
    marks,
    /** Saves a post to the library with its metrics frozen; the overlay's Save action. */
    save: (post: XPost) => {
      if (client === undefined) return options.log("save skipped, service not connected");
      void Effect.runPromise(client[Library_METHODS.save]({ post, collectionId: null })).then(
        () => marks([{ postId: post.postId, handle: post.author.handle }]),
        (error: unknown) => options.log("save failed", String(error)),
      );
    },
    detach: () => void Effect.runPromise(Fiber.interrupt(fiber)),
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

/**
 * Types into x.com's own composer exactly as a user would: focus, insert text,
 * pick files through the hidden input, press Post. The id comes from the
 * CreateTweet response the capture sees, not from any guess. Every step ends
 * by `deadline`; the upload alone may take whatever is left of it.
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
  const textarea = await until(
    contents.loadURL(
      command.replyToPostId === undefined
        ? "https://x.com/compose/post"
        : `https://x.com/intent/post?in_reply_to=${command.replyToPostId}`,
    ),
    deadline,
    "x.com's composer did not load",
  )
    .then(() => waitForNode(cdp, 'div[data-testid="tweetTextarea_0"]', step(COMPOSER_TIMEOUT_MS)))
    .catch((error: unknown) => {
      throw untouched(error);
    });
  await click(cdp, textarea);
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
  await click(cdp, button);
  return until(created, step(CREATED_TIMEOUT_MS), "x.com did not confirm the post");
}

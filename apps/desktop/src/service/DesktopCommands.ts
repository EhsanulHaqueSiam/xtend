import {
  Desktop_METHODS,
  type DesktopCommand,
  type DesktopCommandResult,
  Library_METHODS,
  type Settings,
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

const RECONNECT_MS = 2_000;
const POLL_MS = 250;
const COMPOSER_TIMEOUT_MS = 15_000;
const CREATED_TIMEOUT_MS = 15_000;

type Cdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface DesktopCommandsOptions {
  readonly serviceUrl: string;
  readonly serviceToken: string;
  /** Loads a URL in the session view; only x.com hosts are honoured. */
  readonly navigate: (url: string) => void;
  /** Resolves with the id of the next post the session creates (from the CreateTweet response). */
  readonly nextCreatedPost: () => Promise<string>;
  /** Settings as read on each connect, for the desktop-side toggles (hideXRail). */
  readonly onSettings: (settings: Settings) => void;
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

  const cdp: Cdp = (method, params) => contents.debugger.sendCommand(method, params);
  let client: Client | undefined;

  const run = async (current: Client, command: DesktopCommand): Promise<DesktopCommandResult> => {
    switch (command.type) {
      case "sessionScreenshot": {
        const shot = (await cdp("Page.captureScreenshot", { format: "png" })) as { data: string };
        return { type: "sessionScreenshot", pngBase64: shot.data };
      }
      case "sessionNavigate":
        options.navigate(command.url);
        return { type: "sessionNavigate" };
      case "sessionPost": {
        const settings = await Effect.runPromise(current[WS_METHODS.settingsGet]({}));
        if (!settings.sessionPostingEnabled) throw new Error("session posting is off in Settings");
        const postId = await postThroughComposer(contents, cdp, command, options.nextCreatedPost);
        return { type: "sessionPost", postId };
      }
    }
  };

  const serve = Effect.gen(function* () {
    const current = yield* makeClient;
    client = current;
    options.onSettings(yield* current[WS_METHODS.settingsGet]({}));
    options.log("desktop commands connected");
    yield* current[Desktop_METHODS.subscribeCommands]({}).pipe(
      Stream.runForEach((request) =>
        Effect.promise(() =>
          run(current, request.command).then(
            (result) => ({ id: request.id, result, error: null }),
            (error: unknown) => {
              options.log("desktop command failed", {
                type: request.command.type,
                error: String(error),
              });
              return { id: request.id, result: null, error: String(error) };
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

  return {
    /** Saves a post to the library with its metrics frozen; the overlay's Save action. */
    save: (post: XPost) => {
      if (client === undefined) return options.log("save skipped, service not connected");
      void Effect.runPromise(client[Library_METHODS.save]({ post, collectionId: null })).catch(
        (error: unknown) => options.log("save failed", String(error)),
      );
    },
    detach: () => void Effect.runPromise(Fiber.interrupt(fiber)),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const attributes = async (cdp: Cdp, nodeId: number): Promise<Record<string, string>> => {
  const { attributes: flat } = (await cdp("DOM.getAttributes", { nodeId })) as {
    attributes: Array<string>;
  };
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]!] = flat[i + 1] ?? "";
  return out;
};

/** Polls for a selector until it matches (and `ready` agrees) or the deadline passes. */
async function waitForNode(
  cdp: Cdp,
  selector: string,
  ready: (attrs: Record<string, string>) => boolean = () => true,
  deadline = Date.now() + COMPOSER_TIMEOUT_MS,
): Promise<number> {
  const { root } = (await cdp("DOM.getDocument", { depth: 0 })) as { root: { nodeId: number } };
  const { nodeId } = (await cdp("DOM.querySelector", { nodeId: root.nodeId, selector })) as {
    nodeId: number;
  };
  if (nodeId !== 0 && ready(await attributes(cdp, nodeId))) return nodeId;
  if (Date.now() >= deadline) throw new Error(`composer element not found: ${selector}`);
  await sleep(POLL_MS);
  return waitForNode(cdp, selector, ready, deadline);
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
 * CreateTweet response the capture sees, not from any guess.
 */
async function postThroughComposer(
  contents: Electron.WebContents,
  cdp: Cdp,
  command: Extract<DesktopCommand, { type: "sessionPost" }>,
  nextCreatedPost: () => Promise<string>,
): Promise<string> {
  await contents.loadURL(
    command.replyToPostId === undefined
      ? "https://x.com/compose/post"
      : `https://x.com/intent/post?in_reply_to=${command.replyToPostId}`,
  );
  const textarea = await waitForNode(cdp, 'div[data-testid="tweetTextarea_0"]');
  await click(cdp, textarea);
  await cdp("Input.insertText", { text: command.text });
  if (command.mediaPaths.length > 0) {
    const input = await waitForNode(cdp, 'input[data-testid="fileInput"]');
    await cdp("DOM.setFileInputFiles", { nodeId: input, files: command.mediaPaths });
  }
  // The post button stays disabled while uploads run.
  const created = nextCreatedPost();
  const button = await waitForNode(cdp, 'button[data-testid="tweetButton"]', enabled);
  await click(cdp, button);
  const timeout = sleep(CREATED_TIMEOUT_MS).then(() => {
    throw new Error("x.com did not confirm the post");
  });
  return Promise.race([created, timeout]);
}

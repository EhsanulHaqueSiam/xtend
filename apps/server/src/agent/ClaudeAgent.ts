import {
  createSdkMcpServer,
  query,
  tool,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ThreadBusyError,
  type ThreadId,
  type ThreadNotFoundError,
  type ThreadStoreError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { z } from "zod";

import * as ServerConfig from "../config.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as DesktopChannel from "./DesktopChannel.ts";
import * as ThreadStore from "./ThreadStore.ts";

const MCP_SERVER_NAME = "xtend";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const SYSTEM_PROMPT = `You are Xtend's assistant inside a desktop app that embeds x.com (Twitter).
You help the user understand their X activity and plan what to post. Use the xtend tools to
read what the user's session has observed and to look at the X view. You cannot post, like,
follow or message anyone; say so if asked. Keep answers short and concrete.`;

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .map((block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text"
            ? String((block as { text?: unknown }).text ?? "")
            : "",
        )
        .join("")
    : typeof content === "string"
      ? content
      : "";

export class ClaudeAgent extends Context.Service<
  ClaudeAgent,
  {
    /** Records the message and starts a turn in the background. Returns once the turn is queued. */
    readonly send: (
      threadId: ThreadId,
      text: string,
    ) => Effect.Effect<void, ThreadStoreError | ThreadNotFoundError | ThreadBusyError>;
  }
>()("xtend/agent/ClaudeAgent") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadStore.ThreadStore;
  const observations = yield* ObservationStore.ObservationStore;
  const desktop = yield* DesktopChannel.DesktopChannel;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serviceScope = yield* Scope.Scope;
  // Tool handlers run inside the SDK's event loop, outside any fiber; they re-enter through these services.
  const services = yield* Effect.context<never>();

  const runTool = <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.runPromise(Effect.provide(effect, services));

  const screenshotsDir = path.join(config.baseDir, "screenshots");

  const tools = [
    tool(
      "observations_list_recent",
      "Posts the user's X session has shown recently, newest sighting first, with public metrics. Optional author handle filter.",
      { limit: z.number().int().min(1).max(100).optional(), authorHandle: z.string().optional() },
      async (args) => {
        const result = await runTool(
          observations
            .listRecent({
              ...(args.limit === undefined ? {} : { limit: args.limit }),
              ...(args.authorHandle === undefined ? {} : { authorHandle: args.authorHandle }),
            })
            .pipe(Effect.map((r) => r.posts)),
        );
        return { content: [{ type: "text", text: encodeJson(result) }] };
      },
    ),
    tool(
      "session_screenshot",
      "Screenshot of the x.com view in the desktop app right now. Needs the desktop app open.",
      {},
      async () => {
        const outcome = await runTool(
          Effect.gen(function* () {
            const result = yield* desktop.request("sessionScreenshot");
            if (result.pngBase64 === null) return { error: "no image" };
            const at = DateTime.formatIso(yield* DateTime.now).replaceAll(":", "-");
            const file = path.join(screenshotsDir, `${at}.png`);
            yield* fs.makeDirectory(screenshotsDir, { recursive: true });
            yield* fs.writeFile(file, new Uint8Array(Buffer.from(result.pngBase64, "base64")));
            return { file, pngBase64: result.pngBase64 };
          }).pipe(Effect.catch((error) => Effect.succeed({ error: String(error) }))),
        );
        if ("error" in outcome) {
          return {
            content: [{ type: "text", text: `Screenshot failed: ${outcome.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text", text: `Saved to ${outcome.file}` },
            { type: "image", data: outcome.pngBase64, mimeType: "image/png" },
          ],
        };
      },
    ),
  ];
  const mcpServer = createSdkMcpServer({ name: MCP_SERVER_NAME, tools });
  const allowedTools = tools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`);

  const recordMessage = (threadId: ThreadId, message: SDKMessage) =>
    Effect.gen(function* () {
      if (message.type === "assistant") {
        const content = (message as SDKAssistantMessage).message.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "text" && block.text.trim().length > 0) {
            yield* threads.append(threadId, { type: "assistant_text", text: block.text });
          } else if (block.type === "tool_use") {
            yield* threads.append(threadId, {
              type: "tool_call",
              toolName: block.name,
              input: encodeJson(block.input),
            });
          }
        }
        return false;
      }
      if (message.type === "user") {
        const content = (message as SDKUserMessage).message.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "tool_result") {
            yield* threads.append(threadId, {
              type: "tool_result",
              toolName: block.tool_use_id,
              output: textOf(block.content).slice(0, 4000),
              isError: block.is_error === true,
            });
          }
        }
        return false;
      }
      if (message.type === "result") {
        yield* threads.setClaudeSession(threadId, message.session_id);
        // A limit or auth failure arrives as subtype "success" with is_error set; its text is in result.
        const error = !message.is_error
          ? null
          : "errors" in message && message.errors.length > 0
            ? message.errors.join("; ")
            : "result" in message
              ? message.result
              : message.subtype;
        yield* threads.append(threadId, {
          type: "turn_finished",
          ok: !message.is_error,
          error,
          costUsd: message.total_cost_usd ?? null,
        });
        return true;
      }
      return false;
    });

  const runTurn = Effect.fn("ClaudeAgent.runTurn")(function* (
    threadId: ThreadId,
    text: string,
    resume: string | null,
  ) {
    yield* threads.append(threadId, { type: "turn_started" });
    const run = query({
      prompt: text,
      options: {
        cwd: config.baseDir,
        systemPrompt: SYSTEM_PROMPT,
        // Only our MCP tools; no filesystem, shell or web tools in a social app's assistant.
        tools: [],
        allowedTools,
        mcpServers: { [MCP_SERVER_NAME]: mcpServer },
        settingSources: [],
        permissionMode: "default",
        includePartialMessages: false,
        ...(resume === null ? {} : { resume }),
      },
    });
    // The SDK throws after yielding an error result; only record a finish the result did not.
    let finished = false;
    yield* Stream.fromAsyncIterable(run, (cause) => cause).pipe(
      Stream.runForEach((message) =>
        Effect.map(recordMessage(threadId, message), (isResult) => {
          finished ||= isResult;
        }),
      ),
      Effect.catch((cause) =>
        finished
          ? Effect.void
          : threads.append(threadId, {
              type: "turn_finished",
              ok: false,
              error: String(cause).slice(0, 500),
              costUsd: null,
            }),
      ),
      Effect.ensuring(threads.setStatus(threadId, "idle").pipe(Effect.ignore)),
    );
  });

  const send = Effect.fn("ClaudeAgent.send")(function* (threadId: ThreadId, text: string) {
    const thread = yield* threads.get(threadId);
    if (thread.status === "running") return yield* new ThreadBusyError({ threadId });
    yield* threads.append(threadId, { type: "user_message", text });
    yield* threads.setStatus(threadId, "running");
    yield* runTurn(threadId, text, thread.claudeSessionId).pipe(Effect.forkIn(serviceScope));
  });

  return ClaudeAgent.of({ send });
});

export const layer = Layer.effect(ClaudeAgent, make);

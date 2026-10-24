// @effect-diagnostics nodeBuiltinImport:off -- the MCP transport is newline-delimited JSON on raw stdio streams.
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  Compose_METHODS,
  Library_METHODS,
  Plan_METHODS,
  Scores_METHODS,
  WS_METHODS,
} from "@xtend/contracts";
import * as Schema from "effect/Schema";

import packageJson from "../../package.json" with { type: "json" };
import { RATE_CARD } from "../x/XClient.ts";

/**
 * A hand-rolled MCP server: initialize, tools/list and tools/call over stdio.
 * Each tool is one rpc on the running service, so an agent gets the same
 * behaviour, costs and budget as a click in the app.
 */
const text = { type: "string" } as const;

export const MCP_TOOLS = [
  {
    name: "draft_post",
    description: "Save a post as a draft in Compose. Returns the draft.",
    inputSchema: { type: "object", properties: { text }, required: ["text"] },
  },
  {
    name: "queue_post",
    description: `Save a post and queue it for the next posting slot. Posting costs $${RATE_CARD.post.toFixed(3)} ($${RATE_CARD.postWithLink.toFixed(2)} with a link).`,
    inputSchema: { type: "object", properties: { text }, required: ["text"] },
  },
  {
    name: "report_handle",
    description: "Account score report for an X handle from the stored samples.",
    inputSchema: { type: "object", properties: { handle: text }, required: ["handle"] },
  },
  {
    name: "search_library",
    description: "Search X posts (advanced search syntax works). A paid read unless cached.",
    inputSchema: {
      type: "object",
      properties: { query: text, mode: { type: "string", enum: ["top", "latest"] } },
      required: ["query"],
    },
  },
  {
    name: "spend_summary",
    description: "This month's and today's spend against the budget.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export type Call = (method: string, payload: unknown) => Promise<unknown>;

const Id = Schema.Union([Schema.Number, Schema.String, Schema.Null]);
const Request = Schema.Struct({
  id: Schema.optional(Id),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});
const decodeRequest = Schema.decodeUnknownResult(Request);
const decodeId = Schema.decodeUnknownResult(Schema.Struct({ id: Id }));

const errorReply = (id: typeof Id.Type, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const ToolCall = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeToolCall = Schema.decodeUnknownResult(ToolCall);

const runTool = (name: string, args: Record<string, unknown>, call: Call): Promise<unknown> => {
  switch (name) {
    case "draft_post":
      return call(Compose_METHODS.draftCreate, { blocks: [{ text: args["text"] }] });
    case "queue_post":
      return call(Compose_METHODS.draftCreate, { blocks: [{ text: args["text"] }] }).then((draft) =>
        call(Plan_METHODS.queue, { id: (draft as { id: string }).id }),
      );
    case "report_handle":
      // People type handles as they read them on X; the contract stores them without the @.
      return call(Scores_METHODS.report, {
        handle:
          typeof args["handle"] === "string" ? args["handle"].replace(/^@/, "") : args["handle"],
      });
    case "search_library":
      return call(Library_METHODS.search, { query: args["query"], mode: args["mode"] ?? "top" });
    case "spend_summary":
      return call(WS_METHODS.spendSummary, {});
    default:
      return Promise.reject(new Error(`unknown tool ${name}`));
  }
};

/** Answers one JSON-RPC message; null for notifications. */
export async function handleMcpMessage(message: unknown, call: Call): Promise<unknown> {
  const decoded = decodeRequest(message);
  // Answered rather than dropped: a client waiting on this id would hang.
  if (decoded._tag === "Failure") {
    const id = decodeId(message);
    return errorReply(id._tag === "Success" ? id.success.id : null, -32600, "invalid request");
  }
  const { id, method, params } = decoded.success;
  if (id === undefined) return null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, detail: string) => errorReply(id, code, detail);
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "xtend", version: packageJson.version },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const tool = decodeToolCall(params);
      if (tool._tag === "Failure") return fail(-32602, "name and arguments required");
      try {
        const result = await runTool(tool.success.name, tool.success.arguments ?? {}, call);
        return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        return reply({ content: [{ type: "text", text: String(error) }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${method}`);
  }
}

/** Serves MCP over a line-delimited stdio pair until the input ends. */
export function runMcpStdio(input: Readable, output: Writable, call: Call): Promise<void> {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      message = undefined;
    }
    // Answers go out in request order; a slow search must not reorder a ping after it.
    chain = chain.then(async () => {
      const response =
        message === undefined
          ? errorReply(null, -32700, "parse error")
          : await handleMcpMessage(message, call);
      if (response !== null) output.write(JSON.stringify(response) + "\n");
    });
  });
  return new Promise((resolve) => lines.once("close", () => void chain.then(resolve)));
}

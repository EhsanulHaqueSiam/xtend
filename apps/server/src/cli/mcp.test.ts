// @effect-diagnostics nodeBuiltinImport:off -- an in-process stdio pair is the point of this test.
import { PassThrough } from "node:stream";

import { expect, it } from "vite-plus/test";

import { handleMcpMessage, MCP_TOOLS, runMcpStdio } from "./mcp.ts";

it("lists tools and dispatches a call over a stdio pair", async () => {
  const calls: Array<[string, unknown]> = [];
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Array<string> = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  const done = runMcpStdio(input, output, async (method, payload) => {
    calls.push([method, payload]);
    return { monthUsd: 1.5 };
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "spend_summary", arguments: {} } })}\n`,
  );
  input.end();
  await done;

  const responses = chunks
    .join("")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: number; result: Record<string, unknown> });
  expect(responses.map((r) => r.id)).toEqual([1, 2, 3]);
  expect(responses[1]!.result["tools"]).toHaveLength(MCP_TOOLS.length);
  expect(calls).toEqual([["spend.summary", {}]]);
  expect(responses[2]!.result["content"]).toEqual([
    { type: "text", text: JSON.stringify({ monthUsd: 1.5 }, null, 2) },
  ]);
});

it("answers an unknown method with a JSON-RPC error and a bad tool with isError", async () => {
  const call = () => Promise.resolve({});
  expect(await handleMcpMessage({ jsonrpc: "2.0", id: 9, method: "nope" }, call)).toMatchObject({
    error: { code: -32601 },
  });
  expect(
    await handleMcpMessage(
      { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "nope", arguments: {} } },
      call,
    ),
  ).toMatchObject({ result: { isError: true } });
});

it("answers a line it cannot parse and a request without a method, so no client waits forever", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Array<string> = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
  const done = runMcpStdio(input, output, () => Promise.resolve({}));
  input.write("{not json\n");
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "ping" })}\n`);
  input.end();
  await done;

  const responses = chunks
    .join("")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as unknown);
  expect(responses).toEqual([
    { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
    { jsonrpc: "2.0", id: 4, error: { code: -32600, message: "invalid request" } },
    { jsonrpc: "2.0", id: 5, result: {} },
  ]);
});

it("reports a handle typed with its @", async () => {
  const calls: Array<[string, unknown]> = [];
  const call = (method: string, payload: unknown) => {
    calls.push([method, payload]);
    return Promise.resolve({});
  };
  await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "report_handle", arguments: { handle: "@levelsio" } },
    },
    call,
  );
  expect(calls).toEqual([["scores.report", { handle: "levelsio" }]]);
});

it("queue_post queues the draft it just created", async () => {
  const calls: Array<[string, unknown]> = [];
  const call = (method: string, payload: unknown) => {
    calls.push([method, payload]);
    return Promise.resolve(method === "compose.draftCreate" ? { id: "draft_7f3a" } : {});
  };
  await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "queue_post", arguments: { text: "ship it" } },
    },
    call,
  );
  expect(calls).toEqual([
    ["compose.draftCreate", { blocks: [{ text: "ship it" }] }],
    ["plan.queue", { id: "draft_7f3a" }],
  ]);
});

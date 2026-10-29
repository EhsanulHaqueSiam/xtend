import { describe, expect, it } from "@effect/vitest";

import { codexArgs, isolatedConfig, strictSchema } from "./Codex.ts";

describe("Codex", () => {
  it("asks for one read-only, unsaved run with the schema, the answer file and the prompt on stdin", () => {
    expect(codexArgs({ model: "", schemaPath: "/t/s.json", outPath: "/t/a.json" })).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--output-schema",
      "/t/s.json",
      "--output-last-message",
      "/t/a.json",
      "-",
    ]);
    expect(codexArgs({ model: "m1", schemaPath: "s", outPath: "a" })).toContain("--model");
  });

  it("closes every object and requires every property, nested and in definitions", () => {
    const schema = {
      type: "object",
      properties: { items: { type: "array", items: { $ref: "#/$defs/Item" } } },
      $defs: { Item: { type: "object", properties: { text: { type: "string" } }, required: [] } },
    };
    expect(strictSchema(schema)).toEqual({
      type: "object",
      properties: { items: { type: "array", items: { $ref: "#/$defs/Item" } } },
      additionalProperties: false,
      required: ["items"],
      $defs: {
        Item: {
          type: "object",
          properties: { text: { type: "string" } },
          additionalProperties: false,
          required: ["text"],
        },
      },
    });
  });

  it("keeps the login and model provider, and drops MCP servers and hooks", () => {
    const toml = [
      'model_provider = "p"',
      "[tui]",
      "x = 1",
      "[hooks.state]",
      "a = 1",
      '[hooks.state."f:pre_tool_use:0:0"]',
      "enabled = true",
      "[mcp_servers.treg]",
      'url = "https://example.test"',
      "[model_providers.p]",
      'base_url = "https://p.test/v1"',
    ].join("\n");
    expect(isolatedConfig(toml)).toBe(
      [
        'model_provider = "p"',
        "[tui]",
        "x = 1",
        "[model_providers.p]",
        'base_url = "https://p.test/v1"',
      ].join("\n"),
    );
  });
});

import { describe, expect, it } from "@effect/vitest";

import { codexArgs, isolatedConfig, strictSchema } from "./Codex.ts";

describe("Codex", () => {
  it("asks for one read-only, unsaved, tool-less run with the schema, the answer file and the prompt on stdin", () => {
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
      "-c",
      "mcp_servers={}",
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "code_mode_host",
      "--disable",
      "browser_use",
      "--disable",
      "computer_use",
      "--disable",
      "in_app_browser",
      "--disable",
      "apps",
      "--disable",
      "plugins",
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

  it("keeps only the model keys and provider sections; inline tables and dotted keys stay out", () => {
    const toml = [
      'model_provider = "p"',
      'mcp_servers = { treg = { url = "https://example.test" } }',
      "hooks.state.enabled = true",
      "[tui]",
      "x = 1",
      "[hooks.state]",
      "a = 1",
      "[mcp_servers.treg]",
      'url = "https://example.test"',
      "[model_providers.p]",
      'base_url = "https://p.test/v1"',
      "[model_providers.p.extra]",
      "y = 2",
    ].join("\n");
    expect(isolatedConfig(toml)).toBe(
      [
        'model_provider = "p"',
        "[model_providers.p]",
        'base_url = "https://p.test/v1"',
        "[model_providers.p.extra]",
        "y = 2",
      ].join("\n"),
    );
  });
});

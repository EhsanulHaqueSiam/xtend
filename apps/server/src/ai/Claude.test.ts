// @effect-diagnostics nodeBuiltinImport:off -- a real executable on disk stands in for the CLI.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import * as Claude from "./Claude.ts";
import { mergePath } from "./loginPath.ts";

const fake = (body: string) => {
  const file = NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "xtend-claude-")),
    "claude",
  );
  NodeFS.writeFileSync(file, `#!/bin/sh\ncat > /dev/null\n${body}\n`, { mode: 0o755 });
  return file;
};
const call = (binary: string) =>
  Claude.complete({
    binary,
    path: process.env.PATH ?? "",
    model: "",
    system: "s",
    prompt: "p",
    jsonSchema: { type: "object" },
  }).pipe(Effect.asVoid, Effect.flip, Effect.provide(NodeServices.layer));

describe("Claude.complete", () => {
  it.effect("shows the CLI's own error, like an expired login, not the exit code", () =>
    Effect.gen(function* () {
      const binary = fake(
        `echo '{"type":"result","is_error":true,"result":"Failed to authenticate: OAuth session expired"}'; exit 1`,
      );
      expect(yield* call(binary)).toBe("Failed to authenticate: OAuth session expired");
    }),
  );

  it.effect("says where to set the command when it is not installed", () =>
    Effect.gen(function* () {
      expect(yield* call("/nonexistent/claude")).toContain("Settings, Writing");
    }),
  );
});

describe("mergePath", () => {
  it("puts the login shell's entries first and keeps each once", () => {
    expect(mergePath("/a:/usr/bin", "/usr/bin:/bin")).toBe("/a:/usr/bin:/bin");
    expect(mergePath(undefined, "/usr/bin")).toBe("/usr/bin");
  });
});

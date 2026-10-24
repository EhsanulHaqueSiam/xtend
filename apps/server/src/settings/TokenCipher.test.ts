// @effect-diagnostics nodeBuiltinImport:off -- the key file's mode and contents on disk are the point of this test.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as TokenCipher from "./TokenCipher.ts";

const baseDir = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "xtend-cipher-"));
const keyFile = NodePath.join(baseDir, "secret-key");

/** One service start: the layer reads or writes the key file afresh. */
const start = TokenCipher.TokenCipher.pipe(
  Effect.provide(
    Layer.fresh(TokenCipher.layer).pipe(
      Layer.provide(
        ServerConfig.layer({
          version: "test",
          port: 4820,
          host: "127.0.0.1",
          baseDir,
          dbPath: ":memory:",
          staticDir: undefined,
          devUrl: undefined,
          supervisor: "none",
        }),
      ),
      Layer.provide(NodeServices.layer),
    ),
  ),
);

it.effect("keeps one owner-only key across restarts and replaces a corrupted one", () =>
  Effect.gen(function* () {
    const sealed = (yield* start).encrypt("trg_secret");
    expect(sealed).not.toContain("trg_secret");
    expect(NodeFs.statSync(keyFile).mode & 0o777).toBe(0o600);
    // A restart opens what the last run sealed.
    expect((yield* start).decrypt(sealed)).toBe("trg_secret");

    NodeFs.writeFileSync(keyFile, "not a key\n");
    const fresh = yield* start;
    expect(fresh.decrypt(fresh.encrypt("trg_new"))).toBe("trg_new");
    expect(NodeFs.readFileSync(keyFile, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
  }),
);

// @effect-diagnostics nodeBuiltinImport:off -- AES-GCM comes from the platform.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

const KEY_FILE = "secret-key";
const PREFIX = "v1:";

/**
 * Encrypts the treg token at rest. The key is a 600-mode file in the base
 * dir, so the database alone (backups, copies) does not leak the token; an
 * attacker needs the base dir, which already holds the service auth token.
 */
export class TokenCipher extends Context.Service<
  TokenCipher,
  {
    readonly encrypt: (plain: string) => string;
    readonly decrypt: (stored: string) => string;
  }
>()("xtend/settings/TokenCipher") {}

const make = (key: Buffer): TokenCipher["Service"] => ({
  encrypt: (plain) => {
    const iv = NodeCrypto.randomBytes(12);
    const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `${PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body.toString("hex")}`;
  },
  // Rows written before encryption landed are plain text; they are re-encrypted on the next save.
  decrypt: (stored) => {
    if (!stored.startsWith(PREFIX)) return stored;
    const [iv, tag, body] = stored.slice(PREFIX.length).split(":");
    const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "hex"));
    decipher.setAuthTag(Buffer.from(tag!, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(body!, "hex")), decipher.final()]).toString(
      "utf8",
    );
  },
});

export const layer = Layer.effect(
  TokenCipher,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(config.baseDir, KEY_FILE);
    yield* fs.makeDirectory(config.baseDir, { recursive: true });
    const existing = yield* fs.readFileString(file).pipe(
      Effect.map((s) => s.trim()),
      Effect.orElseSucceed(() => ""),
    );
    if (existing.length === 64) return make(Buffer.from(existing, "hex"));
    const key = NodeCrypto.randomBytes(32);
    yield* fs.writeFileString(file, key.toString("hex") + "\n", { mode: 0o600 });
    return make(key);
  }),
);

/** Tests: a fixed key, no files. */
export const layerTest = Layer.succeed(TokenCipher)(make(Buffer.alloc(32, 7)));

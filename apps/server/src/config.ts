import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import packageJson from "../package.json" with { type: "json" };

const DEFAULT_PORT = 4820;

export class ServerConfig extends Context.Service<
  ServerConfig,
  {
    readonly version: string;
    readonly port: number;
    readonly host: string;
    readonly baseDir: string;
    readonly dbPath: string;
    /** Built web app, served when no dev URL is set. */
    readonly staticDir: string | undefined;
    readonly devUrl: URL | undefined;
  }
>()("corvid/config/ServerConfig") {}

export const layer = (config: ServerConfig["Service"]) => Layer.succeed(ServerConfig)(config);

export interface ResolveOptions {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly baseDir?: string | undefined;
  readonly devUrl?: URL | undefined;
}

/** Paths derive from one base directory so a `--base-dir` moves everything together. */
export const resolve = Effect.fn("ServerConfig.resolve")(function* (options: ResolveOptions) {
  const path = yield* Path.Path;
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const baseDir = path.resolve(
    options.baseDir ?? process.env.CORVID_HOME ?? path.join(homeDir, ".corvid"),
  );
  const staticDir = path.resolve(import.meta.dirname, "..", "..", "web", "dist");
  return ServerConfig.of({
    version: packageJson.version,
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? "127.0.0.1",
    baseDir,
    dbPath: path.join(baseDir, "corvid.sqlite"),
    staticDir: options.devUrl === undefined ? staticDir : undefined,
    devUrl: options.devUrl,
  });
});

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PortSchema } from "@corvid/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import * as ServerConfig from "./config.ts";
import { runServer } from "./server.ts";

const portFlag = Flag.Int("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.String("host").pipe(
  Flag.withDescription("Interface to bind. Loopback by default; a Tailnet IP to share it."),
  Flag.optional,
);
const baseDirFlag = Flag.String("base-dir").pipe(
  Flag.withDescription("Data directory. Defaults to ~/.corvid (CORVID_HOME)."),
  Flag.optional,
);
const devUrlFlag = Flag.String("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Vite dev server to redirect the web UI to instead of serving dist."),
  Flag.optional,
);

const serve = Command.make("corvid", {
  port: portFlag,
  host: hostFlag,
  baseDir: baseDirFlag,
  devUrl: devUrlFlag,
}).pipe(
  Command.withDescription("Run the Corvid service."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.resolve({
        port: Option.getOrUndefined(flags.port),
        host: Option.getOrUndefined(flags.host),
        baseDir: Option.getOrUndefined(flags.baseDir),
        devUrl: Option.getOrUndefined(flags.devUrl),
      });
      return yield* runServer.pipe(Effect.provide(ServerConfig.layer(config)));
    }),
  ),
);

export function runCli() {
  Command.run(serve, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}

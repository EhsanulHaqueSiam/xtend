// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- a dev CLI: argv, a file check and a usage line.
// A fresh dev base dir with a realistic install: every screen has data, nothing in it acts on
// its own or spends (devData.neutralize). `pnpm dev` runs it on a first start.

//   node apps/server/scripts/seed-dev.ts --base-dir .xtend [--size small|heavy] [--frozen]
//     [--assist-url http://127.0.0.1:7820]   where AI assist goes: the dev runner's fake model
import * as NodeFS from "node:fs";
import * as NodeUtil from "node:util";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Sqlite from "../src/persistence/Sqlite.ts";
import * as Seed from "../src/testing/seed.ts";
import { dbPathOf, neutralize, refuseLiveHome } from "./devData.ts";

/**
 * Seeds `baseDir`'s database, which must not exist yet. `now` is when the install was last used:
 * the clock at the minute, or the seed's fixed SEED_NOW when `frozen`, for repeatable captures.
 */
export const seedDev = Effect.fn("seedDev")(function* (options: {
  readonly baseDir: string;
  readonly size: "small" | "heavy";
  readonly frozen: boolean;
  readonly assistUrl: string;
}) {
  refuseLiveHome(options.baseDir);
  const db = dbPathOf(options.baseDir);
  if (NodeFS.existsSync(db))
    return yield* Effect.die(new Error(`${db} exists; seed only a fresh base dir.`));
  const clock = yield* Clock.currentTimeMillis;
  const now = options.frozen ? Seed.SEED_NOW : clock - (clock % 60_000);
  const install = { sizes: options.size === "heavy" ? Seed.SIZES : Seed.SMALL, now };
  const database = Sqlite.layerFromPath(db).pipe(Layer.provide(NodeServices.layer));
  yield* Effect.scoped(
    Effect.flatMap(Layer.build(Seed.layerInstall(install, database)), (context) =>
      neutralize({ now, assistUrl: options.assistUrl }).pipe(Effect.provide(context)),
    ),
  );
  return { db, now };
});

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      "base-dir": { type: "string" },
      size: { type: "string", default: "small" },
      frozen: { type: "boolean", default: false },
      "assist-url": { type: "string", default: "http://127.0.0.1:7820" },
    },
  });
  const baseDir = values["base-dir"];
  const size = values.size;
  if (baseDir === undefined || (size !== "small" && size !== "heavy")) {
    console.error("usage: seed-dev.ts --base-dir <dir> [--size small|heavy] [--frozen]");
    process.exit(1);
  }
  NodeRuntime.runMain(
    seedDev({ baseDir, size, frozen: values.frozen, assistUrl: values["assist-url"] }).pipe(
      Effect.tap(({ db }) => Effect.log(`seeded ${size} dev data into ${db}`)),
      Effect.provide(NodeServices.layer),
    ),
  );
}

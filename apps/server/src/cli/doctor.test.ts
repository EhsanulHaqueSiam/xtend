import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as Doctor from "./doctor.ts";

delete process.env["XTEND_TREG_TOKEN"];

const verdicts = (checks: ReadonlyArray<Doctor.Check>) =>
  Object.fromEntries(checks.map((c) => [c.name, c.ok]));

describe("xtend doctor", () => {
  it.effect("fails what is missing, passes a migrated base dir, and never prints the token", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const baseDir = `${root}/base`;
      const bin = `${root}/bin`;
      yield* fs.makeDirectory(bin);
      yield* fs.writeFileString(`${bin}/claude`, "");
      const input = {
        baseDir,
        dbPath: `${baseDir}/xtend.sqlite`,
        // Nothing listens on port 1, so the connection is refused at once.
        serviceUrl: "http://127.0.0.1:1",
        version: "0.0.1",
        pathEnv: `/nonexistent:${bin}`,
        launchd: { installed: true, loaded: false },
        homeDir: root,
      };

      expect(verdicts(yield* Doctor.runDoctor(input))).toEqual({
        "base dir": false,
        database: false,
        service: false,
        "trace file": false,
        "treg token": false,
        "assist cli": true,
        launchd: false,
      });

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE settings SET treg_token = ${"trg_secret"} WHERE id = 1`;
      }).pipe(Effect.provide(Layer.fresh(Sqlite.layerFromPath(input.dbPath))));
      yield* fs.makeDirectory(`${baseDir}/logs`);
      yield* fs.writeFileString(`${baseDir}/logs/service.trace.ndjson`, "{}\n");
      const written = yield* fs.stat(`${baseDir}/logs/service.trace.ndjson`);
      if (written.mtime._tag === "Some")
        yield* TestClock.setTime(written.mtime.value.getTime() + 5 * 60_000);

      const checks = yield* Doctor.runDoctor({
        ...input,
        launchd: { installed: false, loaded: false },
      });
      expect(verdicts(checks)).toEqual({
        "base dir": true,
        database: true,
        service: false,
        "trace file": true,
        "treg token": true,
        "assist cli": true,
        launchd: true,
      });
      const report = Doctor.formatChecks(checks);
      expect(report).toContain("written 5 min ago");
      expect(report).toContain("set in Settings");
      expect(report).toContain(`claude ${bin}/claude, codex not found`);
      expect(report).not.toContain("trg_secret");
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp)),
    ),
  );
});

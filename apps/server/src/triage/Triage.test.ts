import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import { agentCommand } from "../cli/triage.ts";
import * as ServerConfig from "../config.ts";
import { PLAYBOOK } from "./playbook.ts";
import * as Triage from "./Triage.ts";

delete process.env["XTEND_SERVICE_URL"];
delete process.env["XTEND_TRACE_FILE"];

const NOW = Date.parse("2026-11-01T12:00:00.000Z");
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0-sig_part";

const configFor = (baseDir: string) =>
  ServerConfig.layer({
    version: "0.0.1",
    // Nothing listens on port 1, so the health check is refused at once.
    port: 1,
    host: "127.0.0.1",
    baseDir,
    dbPath: `${baseDir}/xtend.sqlite`,
    staticDir: undefined,
    devUrl: undefined,
    supervisor: "none",
  });

describe("triage", () => {
  it.effect("writes a scrubbed context and the playbook, and says how to start an agent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped();
      yield* TestClock.setTime(NOW);
      yield* fs.makeDirectory(`${baseDir}/logs`);
      const span = {
        name: `Treg.call ${JWT}`,
        traceId: "t1",
        durationMs: 12,
        endTimeUnixNano: String((NOW - 60_000) * 1_000_000),
        exit: {
          _tag: "Failure",
          errorTag: "XApiError",
          cause: 'XApiError: duplicate "my private draft" auth_token=cookieauth999',
        },
      };
      yield* fs.writeFileString(
        `${baseDir}/logs/service.trace.ndjson`,
        `${JSON.stringify(span)}\n`,
      );

      // A folder an earlier build made world-readable is tightened too.
      yield* fs.makeDirectory(`${baseDir}/triage`, { mode: 0o755 });
      yield* fs.chmod(`${baseDir}/triage`, 0o755);
      const prepared = yield* Effect.flatMap(Triage.Triage, (t) => t.prepare("cli")).pipe(
        Effect.provide(
          Triage.layer.pipe(
            Layer.provide(Layer.merge(configFor(baseDir), NodeHttpClient.layerNodeHttp)),
          ),
        ),
      );

      const context = yield* fs.readFileString(prepared.contextFile);
      expect(context).toContain("nothing answers at http://127.0.0.1:1");
      expect(context).toContain("Treg.call <redacted>");
      expect(context).toContain("XApiError");
      for (const secret of [JWT, "cookieauth999", "my private draft"])
        expect(context).not.toContain(secret);
      expect(yield* fs.readFileString(prepared.playbookFile)).toBe(PLAYBOOK);
      const modes = yield* Effect.forEach(
        [
          `${baseDir}/triage`,
          `${baseDir}/triage/source`,
          prepared.dir,
          prepared.contextFile,
          prepared.playbookFile,
        ],
        (p) => Effect.map(fs.stat(p), (info) => info.mode & 0o777),
      );
      expect(modes).toEqual([0o700, 0o700, 0o700, 0o600, 0o600]);
      expect(prepared.dir).toBe(`${baseDir}/triage/2026-11-01T12-00-00.000Z`);
      expect(prepared.start.claude).toBe(
        `cd '${prepared.dir}' && claude '${Triage.LAUNCH_PROMPT}'`,
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("starts the agent in the folder with the playbook as its prompt", () =>
    Effect.sync(() => {
      const command = agentCommand("codex", "/tmp/triage/1");
      expect(command).toMatchObject({
        command: "codex",
        args: [Triage.LAUNCH_PROMPT],
        options: { cwd: "/tmp/triage/1", stdin: "inherit", stdout: "inherit" },
      });
    }),
  );

  it.effect("ships the playbook the repo has", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(import.meta.dirname, "../../../../.github/triage/PLAYBOOK.md");
      expect(yield* fs.readFileString(file)).toBe(PLAYBOOK);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

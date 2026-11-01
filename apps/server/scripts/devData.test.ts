// @effect-diagnostics nodeBuiltinImport:off -- writes a source install's key files and checks the copy left them behind.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Seed from "../src/testing/seed.ts";
import { copyDevDb } from "./copy-dev-db.ts";
import { dbPathOf } from "./devData.ts";
import { seedDev } from "./seed-dev.ts";
import { exec, query } from "./xtend-sqlite-state.ts";

const ASSIST = "http://127.0.0.1:7820";

/** One value per row from `statement` on `baseDir`'s database. */
const read = (baseDir: string, statement: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe<Record<string, unknown>>(statement)).pipe(
    Effect.provide(SqliteClient.layer({ filename: dbPathOf(baseDir), readonly: true })),
  );

/** What would act, spend or reach someone; every count must be zero in a dev database. */
const LIVE_PARTS = `
  SELECT
    (SELECT count(*) FROM rules WHERE enabled = 1) AS rules,
    (SELECT count(*) FROM agents WHERE enabled = 1) AS agents,
    (SELECT count(*) FROM drafts WHERE status = 'posting'
      OR (status = 'queued' AND scheduled_at < strftime('%Y-%m-%dT%H:%M:%fZ', '${DateTime.formatIso(DateTime.makeUnsafe(Seed.SEED_NOW + 23 * 3_600_000))}'))) AS due,
    (SELECT count(*) FROM scheduled_actions WHERE status = 'due') AS undos,
    (SELECT count(*) FROM pending_requests WHERE status = 'pending') AS pending,
    (SELECT count(*) FROM webhook_events) AS webhooks,
    (SELECT count(*) FROM post_analytics_nightly WHERE enabled = 1) AS nightly,
    (SELECT count(*) FROM settings WHERE treg_token IS NOT NULL OR assist_key IS NOT NULL
      OR pool_install_id IS NOT NULL OR session_posting_enabled = 1 OR pool_sharing = 1
      OR daily_library_jobs = 1 OR assist_base_url != '${ASSIST}') AS settings`;
const NONE_LIVE = {
  rules: 0,
  agents: 0,
  due: 0,
  undos: 0,
  pending: 0,
  webhooks: 0,
  nightly: 0,
  settings: 0,
};

const tempDir = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "xtend-devdata-" }),
);

describe("dev data", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("seeds every screen's tables, with nothing live", () =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(yield* tempDir, "home");
        yield* seedDev({ baseDir, size: "small", frozen: true, assistUrl: ASSIST });
        const [counts] = yield* read(
          baseDir,
          `SELECT
            (SELECT count(*) FROM observed_posts) AS observed,
            (SELECT count(DISTINCT status) FROM drafts) AS draftStatuses,
            (SELECT count(*) FROM rule_runs) AS ruleRuns,
            (SELECT count(*) FROM people) AS people,
            (SELECT count(*) FROM agents) AS agents,
            (SELECT count(*) FROM saved_posts) AS saved,
            (SELECT count(*) FROM picks) AS picks,
            (SELECT count(*) FROM api_mentions) AS mentions,
            (SELECT count(*) FROM account_posts) AS ownPosts,
            (SELECT count(*) FROM profile_snapshots) AS snapshots`,
        );
        expect(counts).toEqual({
          observed: Seed.SMALL.observedPosts,
          draftStatuses: 5,
          ruleRuns: Seed.SMALL.ruleRuns,
          people: Seed.SMALL.people,
          agents: 2,
          saved: expect.any(Number),
          picks: expect.any(Number),
          mentions: 12,
          ownPosts: Seed.SMALL.ownPostsKept,
          snapshots: Seed.SMALL.days,
        });
        expect(counts!.saved).toBeGreaterThan(0);
        expect(counts!.picks).toBeGreaterThan(0);
        expect((yield* read(baseDir, LIVE_PARTS))[0]).toEqual(NONE_LIVE);
        // A second seed would mix into data someone may have edited.
        const again = yield* Effect.exit(
          seedDev({ baseDir, size: "small", frozen: true, assistUrl: ASSIST }),
        );
        expect(Exit.isFailure(again)).toBe(true);
      }),
    );

    it.effect("copies an install without its secrets, key files or anything live", () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const source = NodePath.join(dir, "live");
        yield* seedDev({ baseDir: source, size: "small", frozen: true, assistUrl: ASSIST });
        NodeFS.writeFileSync(NodePath.join(source, "auth-token"), "secret");
        NodeFS.writeFileSync(NodePath.join(source, "secret-key"), "secret");
        yield* Effect.flatMap(SqlClient.SqlClient, (sql) =>
          Effect.all([
            sql`UPDATE settings SET treg_token = 'v1:sealed', assist_key = 'k', pool_install_id = 'p',
                session_posting_enabled = 1, pool_sharing = 1, daily_library_jobs = 1`,
            sql`UPDATE rules SET enabled = 1`,
            sql`UPDATE agents SET enabled = 1`,
            sql`UPDATE drafts SET status = 'queued', scheduled_at = '2026-10-28T11:00:00.000Z' WHERE status = 'draft'`,
            sql`UPDATE drafts SET status = 'posting' WHERE status = 'suggested'`,
            sql`INSERT INTO scheduled_actions (rule_id, due_at, undo_json) VALUES (1, '2026-10-28T11:00:00.000Z', '{}')`,
            sql`INSERT INTO pending_requests (rule_id, subject_id, subject_json, description, cost_usd, created_at)
                VALUES (1, 's', '{}', 'like', 0.015, '2026-10-28T11:00:00.000Z')`,
            sql`INSERT INTO webhook_events (rule_id, body_json, at) VALUES (1, '{}', '2026-10-28T11:00:00.000Z')`,
            sql`INSERT INTO post_analytics_nightly (account_id, enabled) VALUES (1, 1)`,
          ]),
        ).pipe(Effect.provide(SqliteClient.layer({ filename: dbPathOf(source) })));
        expect((yield* read(source, LIVE_PARTS))[0]).not.toEqual(NONE_LIVE);

        yield* TestClock.setTime(Seed.SEED_NOW);
        const baseDir = NodePath.join(dir, "dev");
        yield* copyDevDb({ baseDir, source, days: 30, assistUrl: ASSIST });
        expect((yield* read(baseDir, LIVE_PARTS))[0]).toEqual(NONE_LIVE);
        expect(NodeFS.readdirSync(baseDir).filter((f) => !f.startsWith("xtend.sqlite"))).toEqual(
          [],
        );
        const [{ n } = {}] = yield* read(baseDir, "SELECT count(*) AS n FROM observed_posts");
        expect(n).toBe(Seed.SMALL.observedPosts);
      }),
    );

    it.effect("edits a dev database after a backup, and never the live install", () =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(yield* tempDir, "home");
        yield* seedDev({ baseDir, size: "small", frozen: true, assistUrl: ASSIST });
        const backup = yield* exec(
          baseDir,
          "UPDATE drafts SET title = 'Edited' WHERE status = 'draft'",
        );
        expect(NodeFS.existsSync(backup)).toBe(true);
        expect(
          yield* query(baseDir, "SELECT DISTINCT title FROM drafts WHERE status = 'draft'"),
        ).toEqual([{ title: "Edited" }]);
        const live = yield* Effect.exit(
          exec(NodePath.join(NodeOS.homedir(), ".xtend"), "DELETE FROM drafts"),
        );
        expect(Exit.isFailure(live)).toBe(true);
      }),
    );
  });
});

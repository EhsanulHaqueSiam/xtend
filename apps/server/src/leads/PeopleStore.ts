import {
  type Activity,
  type Candidate,
  type LeadList,
  LeadsError,
  type Person,
  type PersonAdd,
  type PersonUpdate,
  type Stage,
  type Tier,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
import { tierFor } from "../scores/ScoreEngine.ts";

const LIST_LIMIT = 200;

/**
 * A 0-100 lead score from what a search row or follower page already knows:
 * reach on a log scale, verified and a filled bio. The AI score from an agent
 * replaces it when present; the Scores screen's follower-based score is a
 * different, paid measurement.
 */
export const lightScore = (p: {
  readonly followers: number | null;
  readonly verified?: boolean;
  readonly bio: string;
}): number =>
  Math.min(
    100,
    Math.round(
      Math.log10(Math.max(p.followers ?? 0, 10)) * 14 +
        (p.verified === true ? 15 : 0) +
        (p.bio.trim() === "" ? 0 : 10),
    ),
  );

/** Scores' tier bands are calibrated 0-1000; the person score is 0-100. */
export const tierOf = (score: number): Tier => tierFor(score * 10);

interface PersonRow {
  readonly id: number;
  readonly handle: string;
  readonly name: string;
  readonly user_id: string | null;
  readonly followers: number | null;
  readonly bio: string;
  readonly stage: Stage;
  readonly notes: string;
  readonly score: number | null;
  readonly tier: Tier | null;
  readonly source: string;
  readonly first_seen: string;
  readonly last_activity: string;
}

interface ActivityRow {
  readonly id: number;
  readonly person_id: number;
  readonly kind: Activity["kind"];
  readonly at: string;
  readonly detail: string;
}

interface ListRow {
  readonly id: number;
  readonly name: string;
  readonly created_at: string;
  readonly members: number;
}

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  handle: r.handle,
  name: r.name,
  userId: r.user_id,
  followers: r.followers,
  bio: r.bio,
  stage: r.stage,
  notes: r.notes,
  score: r.score,
  tier: r.tier,
  source: r.source,
  firstSeen: r.first_seen,
  lastActivity: r.last_activity,
});

const toActivity = (r: ActivityRow): Activity => ({
  id: r.id,
  personId: r.person_id,
  kind: r.kind,
  at: r.at,
  detail: r.detail,
});

/** People, their activity, named lists and the followers already seen. Pure SQLite, no X calls. */
export class PeopleStore extends Context.Service<
  PeopleStore,
  {
    readonly list: (listId?: number) => Effect.Effect<ReadonlyArray<Person>, LeadsError>;
    readonly get: (id: number) => Effect.Effect<Person, LeadsError>;
    readonly activity: (personId: number) => Effect.Effect<ReadonlyArray<Activity>, LeadsError>;
    /** Insert or return the existing row for the handle; appends a "found" activity on insert. */
    readonly add: (input: PersonAdd) => Effect.Effect<Person, LeadsError>;
    /** Bulk add that skips handles already present. One entry per input: the new id, or null when it existed. */
    readonly addMany: (
      people: ReadonlyArray<Candidate>,
      source: string,
      listId?: number,
    ) => Effect.Effect<ReadonlyArray<number | null>, LeadsError>;
    readonly update: (patch: PersonUpdate) => Effect.Effect<Person, LeadsError>;
    readonly setProfile: (
      id: number,
      profile: { readonly userId: string; readonly bio: string; readonly followers: number },
    ) => Effect.Effect<void, LeadsError>;
    readonly logActivity: (
      personId: number,
      kind: Activity["kind"],
      detail: string,
    ) => Effect.Effect<void, LeadsError>;
    readonly knownHandles: Effect.Effect<ReadonlySet<string>, LeadsError>;
    readonly ignoredHandles: Effect.Effect<ReadonlySet<string>, LeadsError>;
    readonly listHandles: (listId: number) => Effect.Effect<ReadonlySet<string>, LeadsError>;
    /** People an agent filed since `sinceIso` with a score at or above `minScore`; the agent_match trigger. */
    readonly agentMatches: (
      minScore: number,
      sinceIso: string,
    ) => Effect.Effect<ReadonlyArray<Person>, LeadsError>;
    readonly lists: Effect.Effect<ReadonlyArray<LeadList>, LeadsError>;
    readonly createList: (name: string) => Effect.Effect<LeadList, LeadsError>;
    /** Records follower ids; returns the ids that were not seen before. */
    readonly markFollowersSeen: (
      followers: ReadonlyArray<{ readonly userId: string; readonly handle: string }>,
    ) => Effect.Effect<ReadonlySet<string>, LeadsError>;
  }
>()("xtend/leads/PeopleStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const fail = (operation: string) => (cause: unknown) =>
    new LeadsError({ operation, detail: String(cause).slice(0, 200), cause });

  const byId = (id: number) =>
    sql<PersonRow>`SELECT * FROM people WHERE id = ${id}`.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(`person ${id} not found`)
          : Effect.succeed(toPerson(rows[0])),
      ),
    );

  const list = Effect.fn("PeopleStore.list")(
    function* (listId?: number) {
      const rows =
        listId === undefined
          ? yield* sql<PersonRow>`
              SELECT * FROM people WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY last_activity DESC LIMIT ${LIST_LIMIT}`
          : yield* sql<PersonRow>`
              SELECT p.* FROM people p JOIN list_members m ON m.person_id = p.id
              WHERE m.list_id = ${listId} ORDER BY p.last_activity DESC LIMIT ${LIST_LIMIT}`;
      return rows.map(toPerson);
    },
    Effect.mapError(fail("list")),
  );

  const get = Effect.fn("PeopleStore.get")(byId, Effect.mapError(fail("get")));

  const activity = Effect.fn("PeopleStore.activity")(
    function* (personId: number) {
      const rows = yield* sql<ActivityRow>`
        SELECT * FROM activity WHERE person_id = ${personId} ORDER BY id DESC LIMIT 100`;
      return rows.map(toActivity);
    },
    Effect.mapError(fail("activity")),
  );

  const insertActivity = (personId: number, kind: Activity["kind"], detail: string) =>
    Effect.gen(function* () {
      const at = yield* now;
      yield* sql`INSERT INTO activity (person_id, kind, at, detail) VALUES (${personId}, ${kind}, ${at}, ${detail})`;
      yield* sql`UPDATE people SET last_activity = ${at} WHERE id = ${personId}`;
    });

  // Returns the new id, or null when the handle already exists.
  const insertOne = (c: Candidate, source: string, listId?: number) =>
    Effect.gen(function* () {
      const at = yield* now;
      const score = c.score ?? lightScore(c);
      const inserted = yield* sql<{ id: number }>`
        INSERT INTO people (handle, name, user_id, followers, bio, score, tier, source, first_seen, last_activity)
        VALUES (${c.handle.toLowerCase()}, ${c.name}, ${c.userId}, ${c.followers}, ${c.bio}, ${score}, ${tierOf(score)}, ${source}, ${at}, ${at})
        ON CONFLICT(handle) DO NOTHING RETURNING id`;
      const id =
        inserted[0]?.id ??
        (yield* sql<{ id: number }>`SELECT id FROM people WHERE handle = ${c.handle}`)[0]!.id;
      if (listId !== undefined)
        yield* sql`INSERT OR IGNORE INTO list_members (list_id, person_id) VALUES (${listId}, ${id})`;
      if (inserted[0] === undefined) return null;
      yield* insertActivity(id, "found", `via ${source}`);
      return id;
    });

  const add = Effect.fn("PeopleStore.add")(
    function* (input: PersonAdd) {
      const id = yield* insertOne(input, input.source, input.listId);
      return id === null
        ? (yield* sql<PersonRow>`SELECT * FROM people WHERE handle = ${input.handle}`).map(
            toPerson,
          )[0]!
        : yield* byId(id);
    },
    Effect.mapError(fail("add")),
  );

  const addMany = Effect.fn("PeopleStore.addMany")(
    function* (people: ReadonlyArray<Candidate>, source: string, listId?: number) {
      return yield* sql.withTransaction(
        Effect.forEach(people, (c) => insertOne(c, source, listId)),
      );
    },
    Effect.mapError(fail("addMany")),
  );

  const update = Effect.fn("PeopleStore.update")(
    function* (patch: PersonUpdate) {
      const current = yield* byId(patch.id);
      yield* sql`
        UPDATE people SET stage = ${patch.stage ?? current.stage}, notes = ${patch.notes ?? current.notes}
        WHERE id = ${patch.id}`;
      if (patch.stage !== undefined && patch.stage !== current.stage)
        yield* insertActivity(patch.id, "note", `stage: ${current.stage} to ${patch.stage}`);
      if (patch.notes !== undefined && patch.notes !== current.notes)
        yield* insertActivity(patch.id, "note", patch.notes.slice(0, 140));
      return yield* byId(patch.id);
    },
    Effect.mapError(fail("update")),
  );

  const setProfile = Effect.fn("PeopleStore.setProfile")(
    function* (
      id: number,
      profile: {
        readonly userId: string;
        readonly bio: string;
        readonly followers: number;
        readonly verified?: boolean;
      },
    ) {
      // An AI score from an agent stays; a light score is recomputed from the fuller profile.
      const current = yield* byId(id);
      const score =
        current.source.startsWith("agent:") && current.score !== null
          ? current.score
          : lightScore(profile);
      yield* sql`
        UPDATE people SET user_id = ${profile.userId}, bio = ${profile.bio}, followers = ${profile.followers},
          score = ${score}, tier = ${tierOf(score)}
        WHERE id = ${id}`;
    },
    Effect.mapError(fail("setProfile")),
  );

  const logActivity = Effect.fn("PeopleStore.logActivity")(
    insertActivity,
    Effect.mapError(fail("logActivity")),
  );

  const handles = (where: "all" | "ignored") =>
    Effect.gen(function* () {
      const rows =
        where === "all"
          ? yield* sql<{
              handle: string;
            }>`SELECT handle FROM people WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}`
          : yield* sql<{
              handle: string;
            }>`SELECT handle FROM people WHERE stage = 'ignored' AND account_id = ${sql.literal(CURRENT_ACCOUNT)}`;
      return new Set(rows.map((r) => r.handle.toLowerCase()));
    }).pipe(Effect.mapError(fail("handles")));

  const listHandles = Effect.fn("PeopleStore.listHandles")(
    function* (listId: number) {
      const rows = yield* sql<{ handle: string }>`
        SELECT p.handle FROM people p JOIN list_members m ON m.person_id = p.id WHERE m.list_id = ${listId}`;
      return new Set(rows.map((r) => r.handle));
    },
    Effect.mapError(fail("listHandles")),
  );

  const agentMatches = Effect.fn("PeopleStore.agentMatches")(
    function* (minScore: number, sinceIso: string) {
      const rows = yield* sql<PersonRow>`
        SELECT * FROM people WHERE source LIKE 'agent:%' AND score >= ${minScore} AND first_seen >= ${sinceIso} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
        ORDER BY id DESC LIMIT ${LIST_LIMIT}`;
      return rows.map(toPerson);
    },
    Effect.mapError(fail("agentMatches")),
  );

  const lists = sql<ListRow>`
    SELECT l.*, (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS members
    FROM lists l WHERE l.account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY l.id DESC`.pipe(
    Effect.map((rows) =>
      rows.map((r): LeadList => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        members: r.members,
      })),
    ),
    Effect.mapError(fail("lists")),
  );

  const createList = Effect.fn("PeopleStore.createList")(
    function* (name: string) {
      const at = yield* now;
      const rows = yield* sql<{ id: number }>`
        INSERT INTO lists (name, created_at) VALUES (${name}, ${at}) RETURNING id`;
      return { id: rows[0]!.id, name, createdAt: at, members: 0 } satisfies LeadList;
    },
    Effect.mapError(fail("createList")),
  );

  const markFollowersSeen = Effect.fn("PeopleStore.markFollowersSeen")(
    function* (followers: ReadonlyArray<{ readonly userId: string; readonly handle: string }>) {
      const at = yield* now;
      const fresh = new Set<string>();
      for (const f of followers) {
        const rows = yield* sql<{ user_id: string }>`
          INSERT INTO followers_seen (user_id, handle, first_seen_at) VALUES (${f.userId}, ${f.handle.toLowerCase()}, ${at})
          ON CONFLICT(user_id) DO NOTHING RETURNING user_id`;
        if (rows[0] !== undefined) fresh.add(rows[0].user_id);
      }
      // Nothing new this check: keep showing the previous batch rather than an empty tab.
      if (fresh.size === 0) {
        const last = yield* sql<{ user_id: string }>`
          SELECT user_id FROM followers_seen
          WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)}
            AND first_seen_at = (SELECT MAX(first_seen_at) FROM followers_seen WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)})`;
        for (const r of last) fresh.add(r.user_id);
      }
      return fresh;
    },
    Effect.mapError(fail("markFollowersSeen")),
  );

  return PeopleStore.of({
    list,
    get,
    activity,
    add,
    addMany,
    update,
    setProfile,
    logActivity,
    knownHandles: handles("all"),
    ignoredHandles: handles("ignored"),
    listHandles,
    agentMatches,
    lists,
    createList,
    markFollowersSeen,
  });
});

export const layer = Layer.effect(PeopleStore, make);

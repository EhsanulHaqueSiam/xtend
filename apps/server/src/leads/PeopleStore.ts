import {
  type Activity,
  type Candidate,
  type LeadList,
  LeadsError,
  type Person,
  type PersonAdd,
  type PersonUpdate,
  type Stage,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

const LIST_LIMIT = 200;

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
    /** Bulk add that skips handles already present. Returns how many were new. */
    readonly addMany: (
      people: ReadonlyArray<Candidate>,
      source: string,
      listId?: number,
    ) => Effect.Effect<number, LeadsError>;
    readonly update: (patch: PersonUpdate) => Effect.Effect<Person, LeadsError>;
    readonly setUserId: (id: number, userId: string) => Effect.Effect<void, LeadsError>;
    readonly logActivity: (
      personId: number,
      kind: Activity["kind"],
      detail: string,
    ) => Effect.Effect<void, LeadsError>;
    readonly knownHandles: Effect.Effect<ReadonlySet<string>, LeadsError>;
    readonly ignoredHandles: Effect.Effect<ReadonlySet<string>, LeadsError>;
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
              SELECT * FROM people ORDER BY last_activity DESC LIMIT ${LIST_LIMIT}`
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
      const inserted = yield* sql<{ id: number }>`
        INSERT INTO people (handle, name, user_id, followers, bio, score, source, first_seen, last_activity)
        VALUES (${c.handle}, ${c.name}, ${c.userId}, ${c.followers}, ${c.bio}, ${c.score ?? null}, ${source}, ${at}, ${at})
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
      const ids = yield* sql.withTransaction(
        Effect.forEach(people, (c) => insertOne(c, source, listId)),
      );
      return ids.filter((id) => id !== null).length;
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

  const setUserId = Effect.fn("PeopleStore.setUserId")(
    function* (id: number, userId: string) {
      yield* sql`UPDATE people SET user_id = ${userId} WHERE id = ${id}`;
    },
    Effect.mapError(fail("setUserId")),
  );

  const logActivity = Effect.fn("PeopleStore.logActivity")(
    insertActivity,
    Effect.mapError(fail("logActivity")),
  );

  const handles = (where: "all" | "ignored") =>
    Effect.gen(function* () {
      const rows =
        where === "all"
          ? yield* sql<{ handle: string }>`SELECT handle FROM people`
          : yield* sql<{ handle: string }>`SELECT handle FROM people WHERE stage = 'ignored'`;
      return new Set(rows.map((r) => r.handle.toLowerCase()));
    }).pipe(Effect.mapError(fail("handles")));

  const lists = sql<ListRow>`
    SELECT l.*, (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS members
    FROM lists l ORDER BY l.id DESC`.pipe(
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
          INSERT INTO followers_seen (user_id, handle, first_seen_at) VALUES (${f.userId}, ${f.handle}, ${at})
          ON CONFLICT(user_id) DO NOTHING RETURNING user_id`;
        if (rows[0] !== undefined) fresh.add(rows[0].user_id);
      }
      // Nothing new this check: keep showing the previous batch rather than an empty tab.
      if (fresh.size === 0) {
        const last = yield* sql<{ user_id: string }>`
          SELECT user_id FROM followers_seen
          WHERE first_seen_at = (SELECT MAX(first_seen_at) FROM followers_seen)`;
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
    setUserId,
    logActivity,
    knownHandles: handles("all"),
    ignoredHandles: handles("ignored"),
    lists,
    createList,
    markFollowersSeen,
  });
});

export const layer = Layer.effect(PeopleStore, make);

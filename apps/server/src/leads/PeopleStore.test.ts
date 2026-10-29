import { describe, expect, it } from "@effect/vitest";
import type { Candidate } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as PeopleStore from "./PeopleStore.ts";

const layerTest = PeopleStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const candidate = (handle: string): Candidate => ({
  handle,
  name: handle,
  userId: null,
  followers: 100,
  bio: "",
});

const switchAccount = (id: number) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`,
  );

describe("PeopleStore", () => {
  it.effect("files one person per handle whatever its case, and still adds them to the list", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const list = yield* people.createList("Founders");
      const alice = yield* people.add({ ...candidate("Alice"), source: "manual" });
      expect(alice.handle).toBe("alice");
      expect((yield* people.add({ ...candidate("ALICE"), source: "manual" })).id).toBe(alice.id);

      const ids = yield* people.addMany([candidate("alice"), candidate("Bob")], "list:1", list.id);
      expect(ids[0]).toBeNull();
      expect(ids[1]).toEqual(expect.any(Number));
      expect((yield* people.list()).map((p) => p.handle).toSorted()).toEqual(["alice", "bob"]);
      expect((yield* people.list(list.id)).map((p) => p.handle).toSorted()).toEqual([
        "alice",
        "bob",
      ]);
      expect((yield* people.lists).map((l) => l.members)).toEqual([2]);
      expect((yield* people.activity(alice.id)).map((a) => a.kind)).toEqual(["found"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("counts who joined a list, people already in People included", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const list = yield* people.createList("Founders");
      yield* people.add({ ...candidate("alice"), source: "manual" });
      expect(yield* people.addToList(list.id, [candidate("Alice"), candidate("bob")])).toBe(2);
      expect(yield* people.addToList(list.id, [candidate("alice"), candidate("carol")])).toBe(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps each account's people apart, even for the same handle", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const list = yield* people.createList("Founders");
      const mine = yield* people.add({ ...candidate("alice"), source: "manual", listId: list.id });
      yield* people.update({ id: mine.id, stage: "customer" });

      yield* switchAccount(2);
      expect(yield* people.knownHandles).toEqual(new Set());
      expect(yield* people.lists).toEqual([]);
      // A list id left over from the other account shows none of its people.
      expect(yield* people.list(list.id)).toEqual([]);
      const theirs = yield* people.add({ ...candidate("alice"), source: "manual" });
      expect(theirs.id).not.toBe(mine.id);
      expect(theirs.stage).toBe("new");
      expect(yield* people.addMany([candidate("Alice")], "agent:x")).toEqual([null]);
      expect((yield* people.list()).map((p) => p.id)).toEqual([theirs.id]);

      yield* switchAccount(1);
      expect((yield* people.list()).map((p) => [p.id, p.stage])).toEqual([[mine.id, "customer"]]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("logs a stage change once, as the move it was", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const p = yield* people.add({ ...candidate("carol"), source: "manual" });
      yield* people.update({ id: p.id, stage: "contacted" });
      yield* people.update({ id: p.id, stage: "contacted", notes: "met at a meetup" });
      expect((yield* people.get(p.id)).stage).toBe("contacted");
      expect((yield* people.activity(p.id)).map((a) => a.detail)).toEqual([
        "met at a meetup",
        "stage: new to contacted",
        "via manual",
      ]);
      expect(yield* Effect.flip(people.update({ id: 999, stage: "customer" }))).toMatchObject({
        _tag: "LeadsError",
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("calls a follower new once per account, and repeats the last batch when none are", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const ada = { userId: "1", handle: "Ada" };
      const bob = { userId: "2", handle: "bob" };
      expect(yield* people.markFollowersSeen([ada])).toEqual(new Set(["1"]));
      yield* TestClock.adjust("1 minute");
      expect(yield* people.markFollowersSeen([ada, bob])).toEqual(new Set(["2"]));
      yield* TestClock.adjust("1 minute");
      expect(yield* people.markFollowersSeen([ada, bob])).toEqual(new Set(["2"]));

      yield* switchAccount(2);
      expect(yield* people.markFollowersSeen([ada, bob])).toEqual(new Set(["1", "2"]));
    }).pipe(Effect.provide(layerTest)),
  );
});

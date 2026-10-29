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
      expect((yield* people.list()).people.map((p) => p.handle).toSorted()).toEqual([
        "alice",
        "bob",
      ]);
      expect(
        (yield* people.list({ listId: list.id })).people.map((p) => p.handle).toSorted(),
      ).toEqual(["alice", "bob"]);
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
      // A person a list brought in says which list, by name.
      const carol = (yield* people.list({ listId: list.id })).people.find(
        (p) => p.handle === "carol",
      );
      expect(carol?.source).toBe("list:Founders");
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
      expect((yield* people.list({ listId: list.id })).people).toEqual([]);
      const theirs = yield* people.add({ ...candidate("alice"), source: "manual" });
      expect(theirs.id).not.toBe(mine.id);
      expect(theirs.stage).toBe("new");
      expect(yield* people.addMany([candidate("Alice")], "agent:x")).toEqual([null]);
      expect((yield* people.list()).people.map((p) => p.id)).toEqual([theirs.id]);

      yield* switchAccount(1);
      expect((yield* people.list()).people.map((p) => [p.id, p.stage])).toEqual([
        [mine.id, "customer"],
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "searches and counts beyond 200 people, with stable pages and account-scoped lists",
    () =>
      Effect.gen(function* () {
        const people = yield* PeopleStore.PeopleStore;
        const list = yield* people.createList("Founders");
        yield* people.addMany(
          Array.from({ length: 251 }, (_, i) => ({
            ...candidate(`lead${i}`),
            bio: i === 0 ? "Rare founder" : "",
          })),
          "manual",
          list.id,
        );
        const first = yield* people.list();
        const second = yield* people.list({ offset: 50 });
        expect(first.people).toHaveLength(50);
        expect(first.total).toBe(251);
        expect(first.counts.new).toBe(251);
        expect(new Set([...first.people, ...second.people].map((p) => p.id)).size).toBe(100);
        expect((yield* people.list({ listId: list.id, offset: 250 })).people).toHaveLength(1);
        const match = yield* people.list({ search: "RARE founder" });
        expect(match.people.map((p) => p.handle)).toEqual(["lead0"]);
        yield* people.update({ id: match.people[0]!.id, stage: "contacted" });
        const filtered = yield* people.list({ stage: "contacted" });
        expect(filtered.total).toBe(1);
        expect(filtered.counts).toEqual({
          new: 250,
          contacted: 1,
          replied: 0,
          customer: 0,
          ignored: 0,
        });
        expect((yield* people.list({ search: "%" })).total).toBe(0);
        expect((yield* people.list({ search: "@LEAD0" })).total).toBe(1);
        expect((yield* people.list({ stage: "contacted", offset: 250 })).offset).toBe(0);
        yield* switchAccount(2);
        expect((yield* people.list({ listId: list.id })).total).toBe(0);
        expect((yield* people.list()).counts.new).toBe(0);
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

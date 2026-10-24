import { describe, expect, it } from "@effect/vitest";
import type { ScoreSample, XProfile } from "@xtend/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as Sqlite from "../persistence/Sqlite.ts";
import * as ScoreStore from "./ScoreStore.ts";

const layerTest = ScoreStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));

const sample = (day: string, score: number): ScoreSample => ({
  handle: "levelsio",
  at: `${day}T09:00:00.000Z`,
  score,
  tier: "Unknown",
  followers: 10,
  sampled: 0,
  pages: 1,
  botShare: 0,
  topFollowers: [],
  categories: [],
  bot: { botShare: 0, followRatio: null, suspicious: [] },
});

const profile = (name: string, avatarUrl: string): XProfile => ({
  userId: "10",
  handle: "levelsio",
  name,
  bio: "building",
  followers: 10,
  following: 1,
  posts: 1,
  verified: true,
  avatarUrl,
  createdAt: null,
  location: null,
  website: null,
});

const dayAfter = (start: string, n: number) =>
  DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(start), { days: n }));

describe("ScoreStore", () => {
  it.effect("keeps the newest year of score and profile history, oldest first", () =>
    Effect.gen(function* () {
      const store = yield* ScoreStore.ScoreStore;
      for (let i = 0; i < 400; i++) {
        const day = dayAfter("2025-01-01", i);
        yield* store.saveSample(sample(day, i), []);
        yield* store.saveProfile(profile(i < 399 ? "Pieter" : "Pieter L", `a${i}`), day);
      }

      const history = yield* store.history("levelsio");
      expect(history).toHaveLength(365);
      expect(history[0]?.score).toBe(35);
      expect(history.at(-1)?.score).toBe(399);
      const { changes, avatarUrl } = yield* store.profileHistory("levelsio");
      expect(avatarUrl).toBe("a399");
      expect(changes.map((c) => [c.day, c.name])).toEqual([
        [dayAfter("2025-01-01", 35), "Pieter"],
        [dayAfter("2025-01-01", 399), "Pieter L"],
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("measures watchlist change back from the latest sample, however old it is", () =>
    Effect.gen(function* () {
      const store = yield* ScoreStore.ScoreStore;
      yield* store.saveSample(sample("2026-01-01", 100), []);
      yield* store.saveSample(sample("2026-01-08", 130), []);
      yield* store.watchAdd("LevelsIO", "2026-01-09T00:00:00.000Z");

      const [entry] = yield* store.watchList;
      expect(entry?.handle).toBe("levelsio");
      expect(entry?.score).toBe(130);
      expect(entry?.change).toEqual({ d1: 30, d7: 30, d14: null, d30: null });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps each account's watchlist apart", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* ScoreStore.ScoreStore;
      const asAccount = (id: number) =>
        sql`UPDATE settings SET current_account_id = ${id} WHERE id = 1`;
      const handles = Effect.map(store.watchList, (list) => list.map((w) => w.handle));

      yield* store.watchAdd("levelsio", "2026-10-01T00:00:00.000Z");
      yield* store.watchAdd("naval", "2026-10-02T00:00:00.000Z");
      yield* asAccount(2);
      expect(yield* handles).toEqual([]);
      yield* store.watchAdd("levelsio", "2026-10-03T00:00:00.000Z");
      expect(yield* handles).toEqual(["levelsio"]);
      yield* store.watchRemove("naval");
      yield* store.watchRemove("levelsio");
      expect(yield* handles).toEqual([]);

      yield* asAccount(1);
      expect(yield* handles).toEqual(["naval", "levelsio"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("caps each account's watchlist at 100 handles", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const store = yield* ScoreStore.ScoreStore;
      for (let i = 0; i < 100; i++) yield* store.watchAdd(`h${i}`, "2026-10-01T00:00:00.000Z");

      const full = yield* Effect.flip(store.watchAdd("naval", "2026-10-02T00:00:00.000Z"));
      expect(full.message).toBe("Scores watchAdd failed: watchlist is full (100)");
      yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
      yield* store.watchAdd("naval", "2026-10-02T00:00:00.000Z");
      expect((yield* store.watchList).map((w) => w.handle)).toEqual(["naval"]);
    }).pipe(Effect.provide(layerTest)),
  );
});

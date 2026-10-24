import { describe, expect, it } from "@effect/vitest";
import { type SignalAgentInput, XApiError, type XPost } from "@xtend/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as Assist from "../ai/Assist.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as XClient from "../x/XClient.ts";
import * as PeopleStore from "./PeopleStore.ts";
import * as SignalAgents from "./SignalAgents.ts";

const postBy = (
  postId: string,
  handle: string,
  followers: number,
  lang: string | null = "en",
): XPost => ({
  postId,
  url: `https://x.com/${handle}/status/${postId}`,
  text: `post ${postId}`,
  createdAt: "2026-10-22T09:00:00.000Z",
  lang,
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: postId, handle, name: handle, followers, verified: false, avatarUrl: null },
  metrics: { views: 10, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const searches: Array<string> = [];
const published: Array<Events.EventInput> = [];
let assistCalls = 0;
// Runs inside the search stub, so a test can act while an agent is mid-run.
let duringSearch: (query: string) => Effect.Effect<void> = () => Effect.void;

const xStub = xClientStub({
  searchPosts: (query) =>
    Effect.gen(function* () {
      searches.push(query);
      yield* duringSearch(query);
      if (query === "down")
        return yield* new XApiError({
          endpoint: "anyapi.x.search.posts",
          reason: "provider",
          status: 503,
          detail: "search is down",
        });
      return {
        items: [
          postBy("1", "ada", 120),
          postBy("2", "ada", 120),
          postBy("3", "bob", 300),
          postBy("4", "carl", 5),
          postBy("5", "dee", 900, "fr"),
          postBy("6", "erin", 50),
        ],
        nextCursor: null,
        fromCache: query === "cached",
      };
    }),
});

// Answers as models do: "@"-prefixed and in whatever case the model likes.
const assistStub = Layer.succeed(Assist.Assist)({
  generate: (request) =>
    Effect.suspend(() => {
      assistCalls++;
      return Schema.decodeUnknownEffect(request.output)([
        { handle: "@Ada", score: 80, reason: "ships rust weekly" },
        { handle: "ERIN", score: 40, reason: "hobbyist" },
      ]).pipe(Effect.orDie);
    }),
});

const eventsStub = Layer.succeed(Events.Events)({
  publish: (event) => Effect.sync(() => void published.push(event)),
  stream: Stream.empty,
});

const layerTest = SignalAgents.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(PeopleStore.layer, SettingsStore.layer, assistStub, eventsStub),
  ),
  Layer.provideMerge(Layer.mergeAll(Sqlite.layerMemory, TokenCipher.layerTest, xStub)),
);

const agentInput = (overrides: Partial<SignalAgentInput>): SignalAgentInput => ({
  name: "Rust",
  query: "rust",
  minFollowers: 10,
  intervalMinutes: 60,
  enabled: true,
  scoringPrompt: "",
  lang: "en",
  excludeBots: false,
  notifyMinScore: null,
  listId: null,
  ...overrides,
});

const reset = Effect.sync(() => {
  searches.length = 0;
  published.length = 0;
  assistCalls = 0;
  duringSearch = () => Effect.void;
});

describe("SignalAgents", () => {
  it.effect(
    "files each new author once, with the model's score, and notifies at the threshold",
    () =>
      Effect.gen(function* () {
        yield* reset;
        const people = yield* PeopleStore.PeopleStore;
        const agents = yield* SignalAgents.SignalAgents;
        yield* people.add({
          handle: "bob",
          name: "Bob",
          userId: null,
          followers: 300,
          bio: "",
          source: "manual",
        });
        const list = yield* people.createList("Rustaceans");
        const agent = yield* agents.upsert(agentInput({ notifyMinScore: 70, listId: list.id }));

        const first = yield* agents.run(agent.id);
        expect(first).toMatchObject({ found: 2, inserted: 2, error: null });
        expect(first.costUsd).toBe(XClient.RATE_CARD.searchPage);
        const filed = (yield* people.list(list.id)).map((p) => [p.handle, p.score, p.source]);
        expect(filed.toSorted()).toEqual([
          ["ada", 80, "agent:Rust"],
          ["erin", 40, "agent:Rust"],
        ]);
        expect(published.map((e) => [e.type, e.payload?.handle])).toEqual([["lead_found", "ada"]]);

        // Everyone it finds is known now: nothing to score, nothing to file, nothing to announce.
        const second = yield* agents.run(agent.id);
        expect(second).toMatchObject({ found: 0, inserted: 0 });
        expect(assistCalls).toBe(1);
        expect(published).toHaveLength(1);
        expect((yield* agents.list)[0]?.lastRun?.id).toBe(second.id);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("logs no search cost for a run the read cache served", () =>
    Effect.gen(function* () {
      yield* reset;
      const agents = yield* SignalAgents.SignalAgents;
      const agent = yield* agents.upsert(agentInput({ query: "cached" }));
      expect(yield* agents.run(agent.id)).toMatchObject({ found: 3, costUsd: 0 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("records a failed run with X's reason instead of failing", () =>
    Effect.gen(function* () {
      yield* reset;
      const agents = yield* SignalAgents.SignalAgents;
      const agent = yield* agents.upsert(agentInput({ query: "down" }));
      const run = yield* agents.run(agent.id);
      expect(run).toMatchObject({ found: 0, inserted: 0, costUsd: 0 });
      expect(run.error).toContain("search is down");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("runs an agent once at a time, so a second click does not pay twice", () =>
    Effect.gen(function* () {
      yield* reset;
      const agents = yield* SignalAgents.SignalAgents;
      const agent = yield* agents.upsert(agentInput({}));
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      duringSearch = () =>
        Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(release));

      const firstRun = yield* Effect.forkChild(agents.run(agent.id));
      yield* Deferred.await(started);
      const second = yield* Effect.flip(agents.run(agent.id));
      expect(second.detail).toContain("already running");
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(firstRun)).error).toBeNull();
      expect(searches).toEqual(["rust"]);

      // Finished runs free the agent again.
      duringSearch = () => Effect.void;
      expect((yield* agents.run(agent.id)).found).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  // Live clock: the due check is SQLite's own 'now', which a test clock cannot move.
  it.live("the tick runs enabled agents and skips one disabled while an earlier one ran", () =>
    Effect.gen(function* () {
      yield* reset;
      const sql = yield* SqlClient.SqlClient;
      const agents = yield* SignalAgents.SignalAgents;
      yield* agents.upsert(agentInput({ name: "A", query: "a" }));
      const b = yield* agents.upsert(agentInput({ name: "B", query: "b" }));
      yield* agents.upsert(agentInput({ name: "C", query: "c", enabled: false }));
      duringSearch = (query) =>
        query === "a"
          ? Effect.orDie(sql`UPDATE agents SET enabled = 0 WHERE id = ${b.id}`)
          : Effect.void;

      yield* agents.tick;
      expect(searches).toEqual(["a"]);
      // A just ran, so a second tick inside its interval does nothing.
      yield* agents.tick;
      expect(searches).toEqual(["a"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("saving changes to an agent that does not exist is an error, not a crash", () =>
    Effect.gen(function* () {
      const agents = yield* SignalAgents.SignalAgents;
      const error = yield* Effect.flip(agents.upsert(agentInput({ id: 999 })));
      expect(error).toMatchObject({ _tag: "LeadsError", detail: "agent 999 not found" });
    }).pipe(Effect.provide(layerTest)),
  );
});

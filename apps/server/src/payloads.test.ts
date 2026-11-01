import { describe, expect, it, layer } from "@effect/vitest";
import {
  Analyze_METHODS,
  Automate_METHODS,
  Compose_METHODS,
  Leads_METHODS,
  Library_METHODS,
  WS_METHODS,
  WsRpcGroup,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import * as Analytics from "./analyze/Analytics.ts";
import * as RuleStore from "./automate/RuleStore.ts";
import * as DraftStore from "./compose/DraftStore.ts";
import * as PeopleStore from "./leads/PeopleStore.ts";
import * as LibraryStore from "./library/LibraryStore.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Seed from "./testing/seed.ts";
import budget from "./payloadBudget.json" with { type: "json" };

/**
 * AGENTS.md rule 4: each list a screen loads, from a heavy user's seed, measured as the WebSocket
 * sends it. payloadBudget.json holds the exact bytes; the ceilings here, measured plus about half,
 * catch a list that loses its cap or carries bodies even with the label that accepts growth.
 */
const wireBytes = (rpc: string, value: unknown) => {
  const success = WsRpcGroup.requests.get(rpc)!.successSchema;
  const bytes = Buffer.byteLength(JSON.stringify(Schema.encodeUnknownSync(success)(value)));
  // The ratchet (.github/workflows/payload-budget.yml) compares this file with main's, so a list
  // can only grow on purpose: in the same PR, with the payload-increase label.
  expect(
    bytes,
    `${rpc} sends ${bytes} bytes; set it in apps/server/src/payloadBudget.json in this change`,
  ).toBe(budget[rpc as keyof typeof budget]);
  return bytes;
};

/**
 * RPCs that answer a list (a top-level array, or "list" in the name) but have no budget here, and
 * why that is safe. A new list RPC lands in the budget above or here, with its reason.
 */
const UNBUDGETED: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    [
      "accounts.list",
      "automate.rulesList",
      "leads.agentsList",
      "leads.listsList",
      "library.collectionsList",
      "scores.watchList",
      "scores.watchAdd",
      "scores.watchRemove",
    ].map((rpc) => [rpc, "the user's own hand-made list: tens of rows"]),
  ),
  ...Object.fromEntries(
    [
      "automate.preview",
      "engage.draftReply",
      "leads.agentSuggest",
      "library.generateReady",
      "library.pickDraft",
      "library.trendIdeas",
      "library.writeInFormat",
      "analyze.themes",
    ].map((rpc) => [rpc, "a model's answer to one click: a handful of items"]),
  ),
  ...Object.fromEntries(
    [
      "analyze.competitors",
      "analyze.engagers",
      "analyze.postStrip",
      "engage.targets",
      "library.forYou",
      "library.staffPicks",
      "library.staffPicksFetch",
      "library.trends",
      "scores.trending",
      "automate.pendingList",
      "automate.ruleRunNow",
      "leads.listAddAll",
      "leads.listAddPeople",
      "leads.listCreate",
      "leads.listPreview",
      "leads.listRemovePerson",
      "library.savedIds",
      "plan.runsList",
    ].map((rpc) => [rpc, "not yet measured: no heavy-seed path; budget it when one exists"]),
  ),
};

const answersList = (rpc: string) =>
  SchemaAST.isArrays(WsRpcGroup.requests.get(rpc)!.successSchema.ast) ||
  /list/i.test(rpc.split(".")[1] ?? "");

it("budgets or explains every list a screen loads", () => {
  const lists = [...WsRpcGroup.requests.keys()].filter(answersList).sort();
  const covered = new Set([...Object.keys(budget), ...Object.keys(UNBUDGETED)]);
  expect(lists.filter((rpc) => !covered.has(rpc))).toEqual([]);
  // No stale entries: every name still exists.
  expect([...covered].filter((rpc) => !WsRpcGroup.requests.has(rpc))).toEqual([]);
});

describe("payload budgets", () => {
  layer(Seed.layer, { timeout: "3 minutes", excludeTestServices: true })((it) => {
    // The Seen screen asks for 100.
    it.effect("observations.listRecent", () =>
      Effect.gen(function* () {
        const result = yield* (yield* ObservationStore.ObservationStore).listRecent({ limit: 100 });
        expect(result.posts).toHaveLength(100);
        expect(wireBytes(WS_METHODS.observationsListRecent, result)).toBeLessThan(110_000);
      }),
    );

    // A bounded page of 50 of the 1,000 people, plus totals for every stage.
    it.effect("leads.peopleList", () =>
      Effect.gen(function* () {
        const people = yield* (yield* PeopleStore.PeopleStore).list();
        expect(people.people).toHaveLength(50);
        expect(people.total).toBe(1000);
        expect(wireBytes(Leads_METHODS.peopleList, people)).toBeLessThan(30_000);
      }),
    );

    // 200 of 300 drafts with whole bodies: the 10 articles on the page are 63 KB of it. The
    // largest answer here, and resent on every draft change.
    it.effect("compose.draftsList", () =>
      Effect.gen(function* () {
        const drafts = yield* (yield* DraftStore.DraftStore).list;
        expect(drafts).toHaveLength(200);
        expect(wireBytes(Compose_METHODS.draftsList, { drafts })).toBeLessThan(420_000);
      }),
    );

    // The newest 200 of 2,000 runs.
    it.effect("automate.runsList", () =>
      Effect.gen(function* () {
        const runs = yield* (yield* RuleStore.RuleStore).runs({});
        expect(runs).toHaveLength(200);
        expect(wireBytes(Automate_METHODS.runsList, runs)).toBeLessThan(60_000);
      }),
    );

    // 100 own posts, 90 daily snapshots and private metrics for 200 posts. Snapshots keep
    // growing for a year (365 cap), about 25 KB more at most.
    it.effect("analyze.data", () =>
      Effect.gen(function* () {
        const data = yield* (yield* Analytics.Analytics).data;
        expect(data.posts).toHaveLength(100);
        expect(data.nonPublic.byPost).toHaveLength(200);
        expect(wireBytes(Analyze_METHODS.data, data)).toBeLessThan(120_000);
      }),
    );

    // One page, the newest 200 of 3,450 saved posts (Staff picks mirror every daily pick); Show
    // more reads the next page.
    it.effect("library.savedList", () =>
      Effect.gen(function* () {
        const saved = yield* (yield* LibraryStore.LibraryStore).savedList({});
        expect([saved.items.length, saved.total]).toEqual([200, 3450]);
        expect(wireBytes(Library_METHODS.savedList, saved)).toBeLessThan(240_000);
      }),
    );

    // One page, the top 200 of 12,000 archived posts by views.
    it.effect("library.browse", () =>
      Effect.gen(function* () {
        const posts = yield* (yield* LibraryStore.LibraryStore).browse({});
        expect([posts.items.length, posts.total]).toEqual([200, 12_000]);
        expect(wireBytes(Library_METHODS.browse, posts)).toBeLessThan(250_000);
      }),
    );
  });
});

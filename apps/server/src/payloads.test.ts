import { describe, expect, layer } from "@effect/vitest";
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

import * as Analytics from "./analyze/Analytics.ts";
import * as RuleStore from "./automate/RuleStore.ts";
import * as DraftStore from "./compose/DraftStore.ts";
import * as PeopleStore from "./leads/PeopleStore.ts";
import * as LibraryStore from "./library/LibraryStore.ts";
import * as ObservationStore from "./observations/ObservationStore.ts";
import * as Seed from "./testing/seed.ts";

/**
 * AGENTS.md rule 4: no oversized WebSocket payloads. Each list a screen loads is produced from a
 * heavy user's database (testing/seed.ts) by the service method its handler calls, then measured
 * as the WebSocket sends it. Budgets are the measured size plus about half again: a field added to
 * a row fits, a list that loses its cap or starts carrying bodies does not. Over budget, shrink the
 * payload; raise a budget only for a field a screen needs.
 */
const wireBytes = (rpc: string, value: unknown) => {
  const success = WsRpcGroup.requests.get(rpc)!.successSchema;
  return Buffer.byteLength(JSON.stringify(Schema.encodeUnknownSync(success)(value)));
};

describe("payload budgets", () => {
  layer(Seed.layer, { timeout: "3 minutes", excludeTestServices: true })((it) => {
    // The Seen screen asks for 100. Measured 71,671 bytes.
    it.effect("observations.listRecent", () =>
      Effect.gen(function* () {
        const result = yield* (yield* ObservationStore.ObservationStore).listRecent({ limit: 100 });
        expect(result.posts).toHaveLength(100);
        expect(wireBytes(WS_METHODS.observationsListRecent, result)).toBeLessThan(110_000);
      }),
    );

    // A full page of 200 of the 1,000 people. Measured 77,578 bytes.
    it.effect("leads.peopleList", () =>
      Effect.gen(function* () {
        const people = yield* (yield* PeopleStore.PeopleStore).list();
        expect(people).toHaveLength(200);
        expect(wireBytes(Leads_METHODS.peopleList, people)).toBeLessThan(120_000);
      }),
    );

    // 200 of 300 drafts with whole bodies: the 10 articles on the page are 63 KB of it. The
    // largest answer here, and resent on every draft change. Measured 273,483 bytes.
    it.effect("compose.draftsList", () =>
      Effect.gen(function* () {
        const drafts = yield* (yield* DraftStore.DraftStore).list;
        expect(drafts).toHaveLength(200);
        expect(wireBytes(Compose_METHODS.draftsList, { drafts })).toBeLessThan(420_000);
      }),
    );

    // The newest 200 of 2,000 runs. Measured 40,120 bytes.
    it.effect("automate.runsList", () =>
      Effect.gen(function* () {
        const runs = yield* (yield* RuleStore.RuleStore).runs({});
        expect(runs).toHaveLength(200);
        expect(wireBytes(Automate_METHODS.runsList, runs)).toBeLessThan(60_000);
      }),
    );

    // 100 own posts, 90 daily snapshots and private metrics for 200 posts. Snapshots keep
    // growing for a year (365 cap), about 25 KB more at most. Measured 79,280 bytes.
    it.effect("analyze.data", () =>
      Effect.gen(function* () {
        const data = yield* (yield* Analytics.Analytics).data;
        expect(data.posts).toHaveLength(100);
        expect(data.nonPublic.byPost).toHaveLength(200);
        expect(wireBytes(Analyze_METHODS.data, data)).toBeLessThan(120_000);
      }),
    );

    // The newest 200 of 3,450 saved posts (Staff picks mirror every daily pick). Measured
    // 158,679 bytes.
    it.effect("library.savedList", () =>
      Effect.gen(function* () {
        const saved = yield* (yield* LibraryStore.LibraryStore).savedList({});
        expect(saved).toHaveLength(200);
        expect(wireBytes(Library_METHODS.savedList, saved)).toBeLessThan(240_000);
      }),
    );

    // The top 200 of 12,000 archived posts by views. Measured 160,474 bytes.
    it.effect("library.browse", () =>
      Effect.gen(function* () {
        const posts = yield* (yield* LibraryStore.LibraryStore).browse({});
        expect(posts).toHaveLength(200);
        expect(wireBytes(Library_METHODS.browse, posts)).toBeLessThan(250_000);
      }),
    );
  });
});

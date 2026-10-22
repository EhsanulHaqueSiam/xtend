import { Leads_METHODS, LeadsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as LeadsOps from "./LeadsOps.ts";
import * as PeopleStore from "./PeopleStore.ts";
import * as SignalAgents from "./SignalAgents.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.mergeAll(
  SignalAgents.layerScheduler,
  SignalAgents.layer,
  LeadsOps.layer,
).pipe(Layer.provideMerge(PeopleStore.layer));

/** RPC handlers for LeadsRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = LeadsRpcGroup.toLayer(
  Effect.gen(function* () {
    const people = yield* PeopleStore.PeopleStore;
    const ops = yield* LeadsOps.LeadsOps;
    const agents = yield* SignalAgents.SignalAgents;
    return LeadsRpcGroup.of({
      [Leads_METHODS.peopleList]: ({ listId }) => people.list(listId),
      [Leads_METHODS.personGet]: ({ id }) =>
        Effect.all({ person: people.get(id), activity: people.activity(id) }),
      [Leads_METHODS.personProfile]: ({ id }) => ops.profile(id),
      [Leads_METHODS.personAdd]: (input) => people.add(input),
      [Leads_METHODS.personUpdate]: (patch) => people.update(patch),
      [Leads_METHODS.draftDm]: ({ id }) => Effect.map(ops.draftDm(id), (text) => ({ text })),
      [Leads_METHODS.sendDm]: ({ id, text }) => ops.sendDm(id, text),
      [Leads_METHODS.listsList]: () => people.lists,
      [Leads_METHODS.listCreate]: ({ name }) => people.createList(name),
      [Leads_METHODS.listPreview]: (criteria) => ops.listPreview(criteria),
      [Leads_METHODS.listAddAll]: ({ listId, people: rows }) =>
        Effect.map(people.addMany(rows, `list:${listId}`, listId), (inserted) => ({ inserted })),
      [Leads_METHODS.agentsList]: () => agents.list,
      [Leads_METHODS.agentUpsert]: (input) => agents.upsert(input),
      [Leads_METHODS.agentRun]: ({ id }) => agents.run(id),
      [Leads_METHODS.agentSuggest]: () => agents.suggest,
      [Leads_METHODS.newFollowers]: () => ops.newFollowers,
    });
  }),
);

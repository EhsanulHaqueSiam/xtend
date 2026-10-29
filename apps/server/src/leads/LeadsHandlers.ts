import { Leads_METHODS, LeadsRpcGroup } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Treg from "../x/Treg.ts";
import * as LeadsOps from "./LeadsOps.ts";
import * as PeopleStore from "./PeopleStore.ts";
import * as SignalAgents from "./SignalAgents.ts";
import * as XExtra from "./XExtra.ts";

/** Services this area adds to the application. Merged into layerAreas in server.ts. */
export const layer = Layer.mergeAll(
  SignalAgents.layerScheduler,
  SignalAgents.layer,
  LeadsOps.layer,
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(PeopleStore.layer, XExtra.layer.pipe(Layer.provide(Treg.layer))),
  ),
);

/** RPC handlers for LeadsRpcGroup. Merged into the WebSocket route in ws.ts. */
export const layerHandlers = LeadsRpcGroup.toLayer(
  Effect.gen(function* () {
    const people = yield* PeopleStore.PeopleStore;
    const ops = yield* LeadsOps.LeadsOps;
    const agents = yield* SignalAgents.SignalAgents;
    return LeadsRpcGroup.of({
      [Leads_METHODS.peopleList]: (query) => people.list(query),
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
        Effect.map(people.addToList(listId, rows), (added) => ({ added })),
      [Leads_METHODS.listAddPeople]: ({ listId, personIds }) =>
        people.addPeopleToList(listId, personIds),
      [Leads_METHODS.listRemovePerson]: ({ listId, personId }) =>
        people.removeFromList(listId, personId),
      [Leads_METHODS.agentsList]: () => agents.list,
      [Leads_METHODS.agentUpsert]: (input) => agents.upsert(input),
      [Leads_METHODS.agentRun]: ({ id }) => agents.run(id),
      [Leads_METHODS.agentSuggest]: () => agents.suggest,
      [Leads_METHODS.newFollowers]: () => ops.newFollowers,
      [Leads_METHODS.engagersQuote]: ({ via }) =>
        Effect.succeed({ costUsd: XExtra.engagersCostUsd(via) }),
      [Leads_METHODS.engagers]: ({ postId, via }) => ops.engagers(postId, via),
      [Leads_METHODS.latestPost]: ({ id }) => ops.latestPost(id),
      [Leads_METHODS.draftReply]: ({ id }) => ops.draftReply(id),
      [Leads_METHODS.sendReply]: ({ id, postId, text }) => ops.sendReply(id, postId, text),
    });
  }),
);

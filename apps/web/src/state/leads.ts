import {
  Leads_METHODS,
  type Candidate,
  type EngagementVia,
  type ListCriteria,
  type PersonAdd,
  type PeopleQuery,
  type PersonUpdate,
  type ReplyTone,
  type SignalAgentInput,
  type XPost,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

/** Each list keeps one bounded query, shared by its header and rows. */
export const peopleQueryAtom = Atom.family((listId: number | null) =>
  Atom.make<PeopleQuery>(listId === null ? {} : { listId }),
);

export const peopleAtom = Atom.family((listId: number | null) =>
  clientRuntime.atom((get) => {
    const query = get(peopleQueryAtom(listId));
    return Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.peopleList](query);
    });
  }),
);

export const personAtom = Atom.family((id: number) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.personGet]({ id });
    }),
  ),
);

export const listsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.listsList]({});
  }),
);

export const agentsAtom = clientRuntime.atom(
  Effect.gen(function* () {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentsList]({});
  }),
);

export const updatePersonAtom = clientRuntime.fn<PersonUpdate>()(
  Effect.fnUntraced(function* (patch) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.personUpdate](patch);
  }),
);

export const addPersonAtom = clientRuntime.fn<PersonAdd>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.personAdd](input);
  }),
);

export const personProfileAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.personProfile]({ id });
  }),
);

// Outreach atoms are per person: a new write to a shared fn atom interrupts the call still
// running, so drafting for one person would cut off a paid call in flight for the one just left.
export const draftDmAtom = Atom.family((id: number) =>
  clientRuntime.fn<ReplyTone>()(
    Effect.fnUntraced(function* (tone) {
      const client = yield* XtendClient;
      return (yield* client[Leads_METHODS.draftDm]({ id, tone })).drafts;
    }),
  ),
);

export const sendDmAtom = Atom.family((id: number) =>
  clientRuntime.fn<string>()(
    Effect.fnUntraced(function* (text) {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.sendDm]({ id, text });
    }),
  ),
);

export const createListAtom = clientRuntime.fn<string>()(
  Effect.fnUntraced(function* (name) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.listCreate]({ name });
  }),
);

export const listPreviewAtom = clientRuntime.fn<ListCriteria>()(
  Effect.fnUntraced(function* (criteria) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.listPreview](criteria);
  }),
);

export const listAddAllAtom = clientRuntime.fn<{
  readonly listId: number;
  readonly people: ReadonlyArray<Candidate>;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.listAddAll](input);
  }),
);

export const upsertAgentAtom = clientRuntime.fn<SignalAgentInput>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentUpsert](input);
  }),
);

export const runAgentAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentRun]({ id });
  }),
);

export const suggestAgentsAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.agentSuggest]({});
  }),
);

export const newFollowersAtom = clientRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.newFollowers]({});
  }),
);

/** What one engagement fetch costs; the service prices it, the client only shows it. */
export const engagersQuoteAtom = Atom.family((via: EngagementVia) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return (yield* client[Leads_METHODS.engagersQuote]({ via })).costUsd;
    }),
  ),
);

export const engagersAtom = clientRuntime.fn<{
  readonly postId: string;
  readonly via: EngagementVia;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.engagers](input);
  }),
);

// Only the button reads X; what the session saw is read straight from observations.
export const latestPostAtom = Atom.family((id: number) =>
  clientRuntime.fn<void>()(
    Effect.fnUntraced(function* () {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.latestPost]({ id, fromX: true });
    }),
  ),
);

export const draftReplyAtom = Atom.family((_id: number) =>
  clientRuntime.fn<{ readonly post: XPost; readonly tone: ReplyTone }>()(
    Effect.fnUntraced(function* (input) {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.draftReply](input);
    }),
  ),
);

export const sendReplyAtom = Atom.family((id: number) =>
  clientRuntime.fn<{ readonly postId: string; readonly text: string }>()(
    Effect.fnUntraced(function* ({ postId, text }) {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.sendReply]({ id, postId, text });
    }),
  ),
);

/** Separate query state so the builder never changes the list or People filters. */
export const listPeopleQueryAtom = Atom.family((listId: number) =>
  Atom.make<PeopleQuery>({ excludeListId: listId }),
);
export const listPeopleAtom = Atom.family((listId: number) =>
  clientRuntime.atom((get) => {
    const query = get(listPeopleQueryAtom(listId));
    get(peopleAtom(listId));
    return Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.peopleList](query);
    });
  }),
);

export const listAddPeopleAtom = clientRuntime.fn<{
  readonly listId: number;
  readonly personIds: ReadonlyArray<number>;
}>()(
  Effect.fnUntraced(function* (input) {
    return yield* (yield* XtendClient)[Leads_METHODS.listAddPeople](input);
  }),
);

export const listRemovePersonAtom = clientRuntime.fn<{
  readonly listId: number;
  readonly personId: number;
}>()(
  Effect.fnUntraced(function* (input) {
    return yield* (yield* XtendClient)[Leads_METHODS.listRemovePerson](input);
  }),
);

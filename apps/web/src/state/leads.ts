import {
  Leads_METHODS,
  type Candidate,
  type EngagementVia,
  type ListCriteria,
  type PersonAdd,
  type PersonUpdate,
  type ReplyTone,
  type SignalAgentInput,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";

import { clientRuntime, XtendClient } from "../rpc/client";

/** People in one list, or everyone when the key is null. */
export const peopleAtom = Atom.family((listId: number | null) =>
  clientRuntime.atom(
    Effect.gen(function* () {
      const client = yield* XtendClient;
      return yield* client[Leads_METHODS.peopleList](listId === null ? {} : { listId });
    }),
  ),
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

export const draftDmAtom = clientRuntime.fn<{
  readonly id: number;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return (yield* client[Leads_METHODS.draftDm](input)).drafts;
  }),
);

export const sendDmAtom = clientRuntime.fn<{ readonly id: number; readonly text: string }>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.sendDm](input);
  }),
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

export const latestPostAtom = clientRuntime.fn<number>()(
  Effect.fnUntraced(function* (id) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.latestPost]({ id });
  }),
);

export const draftReplyAtom = clientRuntime.fn<{
  readonly id: number;
  readonly tone?: ReplyTone | undefined;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.draftReply](input);
  }),
);

export const sendReplyAtom = clientRuntime.fn<{
  readonly id: number;
  readonly postId: string;
  readonly text: string;
}>()(
  Effect.fnUntraced(function* (input) {
    const client = yield* XtendClient;
    return yield* client[Leads_METHODS.sendReply](input);
  }),
);

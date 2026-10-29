import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { IsoDateTime, NonNegativeInt, XHandle, XId } from "./baseSchemas.ts";
import { Tier } from "./scores.ts";
import { XApiError, XFollower, XPost, XProfile } from "./x.ts";

/** Leads screen contracts: schemas, errors, method names and the RPC group. Owned by the leads area. */

export const Stage = Schema.Literals(["new", "contacted", "replied", "customer", "ignored"]);
export type Stage = typeof Stage.Type;

export const Score = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

export const Person = Schema.Struct({
  id: Schema.Int,
  handle: XHandle,
  name: Schema.String,
  /** Null until a profile fetch fills it; DMs need it. */
  userId: Schema.NullOr(XId),
  followers: Schema.NullOr(NonNegativeInt),
  bio: Schema.String,
  stage: Stage,
  notes: Schema.String,
  score: Schema.NullOr(Score),
  /** Scores' tier labels over the 0-100 person score. */
  tier: Schema.NullOr(Tier),
  /** Where the row came from: "list:<name>", "agent:<name>", "followers", "manual". */
  source: Schema.String,
  firstSeen: IsoDateTime,
  lastActivity: IsoDateTime,
});
export type Person = typeof Person.Type;

export const ActivityKind = Schema.Literals(["found", "replied", "liked", "dm", "note"]);

export const Activity = Schema.Struct({
  id: Schema.Int,
  personId: Schema.Int,
  kind: ActivityKind,
  at: IsoDateTime,
  detail: Schema.String,
});
export type Activity = typeof Activity.Type;

/** What a list search or follower check knows about someone before they are a Person. */
export const Candidate = Schema.Struct({
  handle: XHandle,
  name: Schema.String,
  userId: Schema.NullOr(XId),
  followers: Schema.NullOr(NonNegativeInt),
  bio: Schema.String,
  score: Schema.optional(Schema.NullOr(Score)),
});
export type Candidate = typeof Candidate.Type;

export const PersonAdd = Schema.Struct({
  ...Candidate.fields,
  source: Schema.String,
  listId: Schema.optional(Schema.Int),
});
export type PersonAdd = typeof PersonAdd.Type;

export const PersonUpdate = Schema.Struct({
  id: Schema.Int,
  stage: Schema.optional(Stage),
  notes: Schema.optional(Schema.String),
});
export type PersonUpdate = typeof PersonUpdate.Type;

export const LeadList = Schema.Struct({
  id: Schema.Int,
  name: Schema.String,
  createdAt: IsoDateTime,
  members: NonNegativeInt,
});
export type LeadList = typeof LeadList.Type;

export const ListCriteria = Schema.Struct({
  query: Schema.String,
  minFollowers: Schema.optional(NonNegativeInt),
  maxFollowers: Schema.optional(NonNegativeInt),
  bioKeyword: Schema.optional(Schema.String),
});
export type ListCriteria = typeof ListCriteria.Type;

export const AgentRun = Schema.Struct({
  id: Schema.Int,
  agentId: Schema.Int,
  at: IsoDateTime,
  found: NonNegativeInt,
  inserted: NonNegativeInt,
  costUsd: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export type AgentRun = typeof AgentRun.Type;

export const SignalAgentInput = Schema.Struct({
  id: Schema.optional(Schema.Int),
  name: Schema.String,
  query: Schema.String,
  minFollowers: NonNegativeInt,
  intervalMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  enabled: Schema.Boolean,
  scoringPrompt: Schema.String,
  /** Only posts in this language (X's two-letter code); null keeps every language. */
  lang: Schema.NullOr(Schema.String),
  /** Drop authors that look like bots (tiny follow-everyone accounts, blank bios, accounts under 90 days). Costs one profile read per new author. */
  excludeBots: Schema.Boolean,
  /** Publish a lead_found event for new people at or above this score; null never notifies. */
  notifyMinScore: Schema.NullOr(Score),
  /** List new people are filed into, besides the people table. */
  listId: Schema.NullOr(Schema.Int),
});
export type SignalAgentInput = typeof SignalAgentInput.Type;

export const SignalAgent = Schema.Struct({
  ...SignalAgentInput.fields,
  id: Schema.Int,
  lastRun: Schema.NullOr(AgentRun),
});
export type SignalAgent = typeof SignalAgent.Type;

export const AgentSuggestion = Schema.Struct({
  name: Schema.String,
  query: Schema.String,
  scoringPrompt: Schema.String,
});
export type AgentSuggestion = typeof AgentSuggestion.Type;

export const NewFollower = Schema.Struct({
  ...XFollower.fields,
  inPeople: Schema.Boolean,
  score: Score,
  tier: Tier,
});

export const EngagementVia = Schema.Literals(["like", "repost"]);
export type EngagementVia = typeof EngagementVia.Type;

export const EngagersInput = Schema.Struct({ postId: XId, via: EngagementVia });
export type EngagersInput = typeof EngagersInput.Type;

export const PersonReplyDraft = Schema.Struct({ post: XPost, text: Schema.String });
export type PersonReplyDraft = typeof PersonReplyDraft.Type;
export type NewFollower = typeof NewFollower.Type;

export class LeadsError extends Schema.TaggedError<LeadsError>()("LeadsError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Leads failed during ${this.operation}: ${this.detail}`;
  }
}

const LeadsOrX = Schema.Union([LeadsError, XApiError]);

export const Leads_METHODS = {
  peopleList: "leads.peopleList",
  personGet: "leads.personGet",
  personProfile: "leads.personProfile",
  personAdd: "leads.personAdd",
  personUpdate: "leads.personUpdate",
  draftDm: "leads.draftDm",
  sendDm: "leads.sendDm",
  listsList: "leads.listsList",
  listCreate: "leads.listCreate",
  listPreview: "leads.listPreview",
  listAddAll: "leads.listAddAll",
  agentsList: "leads.agentsList",
  agentUpsert: "leads.agentUpsert",
  agentRun: "leads.agentRun",
  agentSuggest: "leads.agentSuggest",
  newFollowers: "leads.newFollowers",
  engagersQuote: "leads.engagersQuote",
  engagers: "leads.engagers",
  latestPost: "leads.latestPost",
  draftReply: "leads.draftReply",
  sendReply: "leads.sendReply",
} as const;

export const LeadsRpcGroup = RpcGroup.make(
  Rpc.make(Leads_METHODS.peopleList, {
    payload: Schema.Struct({ listId: Schema.optional(Schema.Int) }),
    success: Schema.Array(Person),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.personGet, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.Struct({ person: Person, activity: Schema.Array(Activity) }),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.personProfile, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.NullOr(XProfile),
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.personAdd, { payload: PersonAdd, success: Person, error: LeadsError }),
  Rpc.make(Leads_METHODS.personUpdate, {
    payload: PersonUpdate,
    success: Person,
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.draftDm, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.Struct({ text: Schema.String }),
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.sendDm, {
    payload: Schema.Struct({ id: Schema.Int, text: Schema.String }),
    success: Schema.Void,
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.listsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(LeadList),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.listCreate, {
    payload: Schema.Struct({ name: Schema.String }),
    success: LeadList,
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.listPreview, {
    payload: ListCriteria,
    success: Schema.Struct({ matches: Schema.Array(Candidate), costUsd: Schema.Number }),
    error: LeadsOrX,
  }),
  /** `added` counts who joined the list, whether or not they were in People already. */
  Rpc.make(Leads_METHODS.listAddAll, {
    payload: Schema.Struct({ listId: Schema.Int, people: Schema.Array(Candidate) }),
    success: Schema.Struct({ added: NonNegativeInt }),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.agentsList, {
    payload: Schema.Struct({}),
    success: Schema.Array(SignalAgent),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.agentUpsert, {
    payload: SignalAgentInput,
    success: SignalAgent,
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.agentRun, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: AgentRun,
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.agentSuggest, {
    payload: Schema.Struct({}),
    success: Schema.Array(AgentSuggestion),
    error: LeadsError,
  }),
  Rpc.make(Leads_METHODS.newFollowers, {
    payload: Schema.Struct({}),
    success: Schema.Struct({ followers: Schema.Array(NewFollower), costUsd: Schema.Number }),
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.engagersQuote, {
    payload: Schema.Struct({ via: EngagementVia }),
    success: Schema.Struct({ costUsd: Schema.Number }),
    error: LeadsError,
  }),
  /** Who liked or reposted a post, as candidates for a list. */
  Rpc.make(Leads_METHODS.engagers, {
    payload: EngagersInput,
    success: Schema.Struct({ matches: Schema.Array(Candidate), costUsd: Schema.Number }),
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.latestPost, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: Schema.NullOr(XPost),
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.draftReply, {
    payload: Schema.Struct({ id: Schema.Int }),
    success: PersonReplyDraft,
    error: LeadsOrX,
  }),
  Rpc.make(Leads_METHODS.sendReply, {
    payload: Schema.Struct({ id: Schema.Int, postId: XId, text: Schema.String }),
    success: Schema.Struct({ postId: XId }),
    error: LeadsOrX,
  }),
);

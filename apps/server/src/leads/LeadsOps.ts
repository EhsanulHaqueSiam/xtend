import {
  type Candidate,
  LEADS_COST_USD,
  LeadsError,
  type ListCriteria,
  type NewFollower,
  type XApiError,
  type XProfile,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as PeopleStore from "./PeopleStore.ts";

const PREVIEW_LIMIT = 50;
const DM_CONTEXT_POSTS = 5;

const DmDraft = Schema.Struct({ text: Schema.String });

/** The leads operations that touch X or the assistant: profiles, DMs, list building, follower diffs. */
export class LeadsOps extends Context.Service<
  LeadsOps,
  {
    /** Cached 6h by XClient; also backfills the person's user id for DMs. */
    readonly profile: (personId: number) => Effect.Effect<XProfile | null, LeadsError | XApiError>;
    readonly draftDm: (personId: number) => Effect.Effect<string, LeadsError | XApiError>;
    readonly sendDm: (
      personId: number,
      text: string,
    ) => Effect.Effect<void, LeadsError | XApiError>;
    readonly listPreview: (
      criteria: ListCriteria,
    ) => Effect.Effect<
      { readonly matches: ReadonlyArray<Candidate>; readonly costUsd: number },
      LeadsError | XApiError
    >;
    readonly newFollowers: Effect.Effect<
      { readonly followers: ReadonlyArray<NewFollower>; readonly costUsd: number },
      LeadsError | XApiError
    >;
  }
>()("xtend/leads/LeadsOps") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const people = yield* PeopleStore.PeopleStore;
  const assistFail = (operation: string) => (e: Assist.AssistError) =>
    new LeadsError({ operation, detail: e.message, cause: e });

  const profile = Effect.fn("LeadsOps.profile")(function* (personId: number) {
    const person = yield* people.get(personId);
    const found = yield* x.profile(person.handle, "leads.profile");
    if (found !== null && person.userId === null) yield* people.setUserId(personId, found.userId);
    return found;
  });

  const draftDm = Effect.fn("LeadsOps.draftDm")(function* (personId: number) {
    const person = yield* people.get(personId);
    const posts = yield* x.userPosts(person.handle, { purpose: "leads.draftDm" });
    const draft = yield* assist
      .generate({
        task: "leads.draftDm",
        instructions:
          "Write a short DM opener (under 300 characters) to this person. Reference something specific from one of their recent posts. Friendly, curious, not salesy, no pitch, no links, one question at most.",
        input: {
          person: { handle: person.handle, name: person.name, bio: person.bio },
          recentPosts: posts.items.slice(0, DM_CONTEXT_POSTS).map((p) => p.text),
        },
        output: DmDraft,
      })
      .pipe(Effect.mapError(assistFail("draftDm")));
    return draft.text;
  });

  const sendDm = Effect.fn("LeadsOps.sendDm")(function* (personId: number, text: string) {
    const person = yield* people.get(personId);
    const userId = person.userId ?? (yield* profile(personId))?.userId;
    if (userId === undefined)
      return yield* new LeadsError({
        operation: "sendDm",
        detail: `no X user id for @${person.handle}`,
        cause: null,
      });
    yield* x.sendDm(userId, text, "leads.dm");
    yield* people.logActivity(personId, "dm", text.slice(0, 140));
    yield* people.update({ id: personId, stage: "contacted" });
  });

  // One latest search, authors deduped and filtered; profiles are fetched only when a bio keyword needs them.
  const listPreview = Effect.fn("LeadsOps.listPreview")(function* (criteria: ListCriteria) {
    const ignored = yield* people.ignoredHandles;
    const page = yield* x.searchPosts(criteria.query, {
      mode: "latest",
      limit: PREVIEW_LIMIT,
      purpose: "leads.listPreview",
    });
    const seen = new Set<string>();
    const authors: Array<Candidate> = [];
    for (const p of page.items) {
      const key = p.author.handle.toLowerCase();
      if (seen.has(key) || ignored.has(key)) continue;
      seen.add(key);
      const f = p.author.followers;
      if (criteria.minFollowers !== undefined && (f ?? 0) < criteria.minFollowers) continue;
      if (criteria.maxFollowers !== undefined && (f ?? 0) > criteria.maxFollowers) continue;
      authors.push({
        handle: p.author.handle,
        name: p.author.name,
        userId: p.author.userId,
        followers: f,
        bio: "",
      });
    }
    const keyword = criteria.bioKeyword?.trim().toLowerCase() ?? "";
    if (keyword === "") return { matches: authors, costUsd: LEADS_COST_USD.search };
    const withBio = yield* Effect.forEach(authors, (a) =>
      Effect.map(x.profile(a.handle, "leads.listPreview"), (p): Array<Candidate> =>
        p === null || !p.bio.toLowerCase().includes(keyword)
          ? []
          : [{ ...a, userId: p.userId, followers: p.followers, bio: p.bio }],
      ),
    );
    return {
      matches: withBio.flat(),
      costUsd: LEADS_COST_USD.search + authors.length * LEADS_COST_USD.profile,
    };
  });

  const newFollowers = Effect.gen(function* () {
    const { handle } = yield* settings.get.pipe(
      Effect.mapError(
        (e) => new LeadsError({ operation: "newFollowers", detail: e.message, cause: e }),
      ),
    );
    if (handle === null)
      return yield* new LeadsError({
        operation: "newFollowers",
        detail: "set your X handle in Settings first",
        cause: null,
      });
    const page = yield* x.followers(handle, { purpose: "leads.newFollowers" });
    const fresh = yield* people.markFollowersSeen(page.items);
    const known = yield* people.knownHandles;
    return {
      followers: page.items
        .filter((f) => fresh.has(f.userId))
        .map((f): NewFollower => ({ ...f, inPeople: known.has(f.handle.toLowerCase()) })),
      costUsd: LEADS_COST_USD.followersPage,
    };
  });

  return LeadsOps.of({ profile, draftDm, sendDm, listPreview, newFollowers });
});

export const layer = Layer.effect(LeadsOps, make);

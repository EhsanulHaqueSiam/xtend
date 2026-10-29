import {
  type Candidate,
  type EngagementVia,
  LeadsError,
  type ListCriteria,
  type NewFollower,
  type Person,
  type ReplyTone,
  type XApiError,
  type XPost,
  type XProfile,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Assist from "../ai/Assist.ts";
import { observedToPost } from "../engage/inbox.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as SessionPosting from "../compose/SessionPosting.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as XClient from "../x/XClient.ts";
import * as PeopleStore from "./PeopleStore.ts";
import * as XExtra from "./XExtra.ts";

const PREVIEW_LIMIT = 50;
const DM_CONTEXT_POSTS = 5;

const Drafts = Schema.Struct({ drafts: Schema.Array(Schema.Struct({ text: Schema.String })) });
const texts = ({ drafts }: typeof Drafts.Type) => drafts.map((d) => d.text).slice(0, 3);

/** The leads operations that touch X or the assistant: profiles, DMs, list building, follower diffs. */
export class LeadsOps extends Context.Service<
  LeadsOps,
  {
    /** Cached 6h by XClient; writes the user id, bio and follower count back onto the person. */
    readonly profile: (personId: number) => Effect.Effect<XProfile | null, LeadsError | XApiError>;
    /** Three openers in the picked tone, for the chooser. */
    readonly draftDm: (
      personId: number,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<string>, LeadsError | XApiError>;
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
    /** Who liked or reposted a post, minus people already ignored. */
    readonly engagers: (
      postId: string,
      via: EngagementVia,
    ) => Effect.Effect<
      { readonly matches: ReadonlyArray<Candidate>; readonly costUsd: number },
      LeadsError | XApiError
    >;
    /**
     * The person's newest original post, else their newest reply, to reply to from their page:
     * from what the session saw unless `fromX` (cached 1h by XClient), or when it saw nothing.
     */
    readonly latestPost: (
      personId: number,
      fromX?: boolean,
    ) => Effect.Effect<XPost | null, LeadsError | XApiError>;
    /** Three replies to the post on screen, in the picked tone. */
    readonly draftReply: (
      post: XPost,
      tone?: ReplyTone,
    ) => Effect.Effect<ReadonlyArray<string>, LeadsError>;
    readonly sendReply: (
      personId: number,
      postId: string,
      text: string,
    ) => Effect.Effect<{ readonly postId: string }, LeadsError | XApiError>;
  }
>()("xtend/leads/LeadsOps") {}

const make = Effect.gen(function* () {
  const x = yield* XClient.XClient;
  const assist = yield* Assist.Assist;
  const settings = yield* SettingsStore.SettingsStore;
  const session = yield* SessionPosting.SessionPosting;
  const people = yield* PeopleStore.PeopleStore;
  const observations = yield* ObservationStore.ObservationStore;
  // What the session saw them post, newest first; reading it costs nothing.
  const seenPosts = (handle: string) =>
    observations.listRecent({ authorHandle: handle, limit: 20 }).pipe(
      Effect.map(({ posts }) => posts.map(observedToPost)),
      Effect.orElseSucceed((): ReadonlyArray<XPost> => []),
    );
  const extra = yield* XExtra.XExtra;
  const rates = XClient.RATE_CARD;
  const assistFail = (operation: string) => (e: Assist.AssistError) =>
    new LeadsError({ operation, detail: e.message, cause: e });

  const profile = Effect.fn("LeadsOps.profile")(function* (personId: number) {
    const person = yield* people.get(personId);
    const found = yield* x.profile(person.handle, "leads.profile");
    if (found !== null) yield* people.setProfile(personId, found);
    return found;
  });

  const draftDm = Effect.fn("LeadsOps.draftDm")(function* (personId: number, tone?: ReplyTone) {
    const person = yield* people.get(personId);
    // Free first: only what the session saw them post; the bio carries the draft without it.
    const posts = yield* seenPosts(person.handle);
    const drafts = yield* assist
      .generate({
        task: "leads.draftDm",
        tone,
        instructions:
          "Write 3 different short DM openers (each under 300 characters) to this person. Each references something specific from one of their recent posts. Curious, not salesy, no pitch, no links, one question at most.",
        input: {
          person: { handle: person.handle, name: person.name, bio: person.bio },
          recentPosts: posts.slice(0, DM_CONTEXT_POSTS).map((p) => p.text),
        },
        output: Drafts,
      })
      .pipe(Effect.mapError(assistFail("draftDm")));
    return texts(drafts);
  });

  // Reaching out moves a new lead along; it never pulls a replied lead or a customer back.
  const markContacted = (person: Person) =>
    person.stage === "new"
      ? Effect.asVoid(people.update({ id: person.id, stage: "contacted" }))
      : Effect.void;

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
    yield* markContacted(person);
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
    if (keyword === "") return { matches: authors, costUsd: rates.searchPage };
    const withBio = yield* Effect.forEach(authors, (a) =>
      Effect.map(x.profile(a.handle, "leads.listPreview"), (p): Array<Candidate> =>
        p === null || !p.bio.toLowerCase().includes(keyword)
          ? []
          : [{ ...a, userId: p.userId, followers: p.followers, bio: p.bio }],
      ),
    );
    return {
      matches: withBio.flat(),
      costUsd: rates.searchPage + authors.length * rates.scraperProfile,
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
        detail: "no X handle yet; it comes from your X session, or set it in Settings",
        cause: null,
      });
    const page = yield* x.followers(handle, { purpose: "leads.newFollowers", fresh: true });
    const fresh = yield* people.markFollowersSeen(page.items);
    const known = yield* people.knownHandles;
    return {
      followers: page.items
        .filter((f) => fresh.has(f.userId))
        .map((f): NewFollower => {
          const score = PeopleStore.lightScore(f);
          return Object.assign(
            { inPeople: known.has(f.handle), score, tier: PeopleStore.tierOf(score) },
            f,
          );
        }),
      costUsd: page.fromCache ? 0 : rates.followersPage,
    };
  });

  const engagers = Effect.fn("LeadsOps.engagers")(function* (postId: string, via: EngagementVia) {
    const ignored = yield* people.ignoredHandles;
    const { matches, costUsd } = yield* extra.engagers(postId, via, "leads.engagers");
    return { matches: matches.filter((m) => !ignored.has(m.handle)), costUsd };
  });

  // A repost is someone else's post wearing this handle; a reply of theirs beats it.
  const newestOwn = (posts: ReadonlyArray<XPost>) => {
    const own = posts.filter((p) => !p.isRepost);
    return own.find((p) => !p.isReply) ?? own[0] ?? null;
  };

  const latestPost = Effect.fn("LeadsOps.latestPost")(function* (personId: number, fromX = false) {
    const person = yield* people.get(personId);
    const seen = fromX ? null : newestOwn(yield* seenPosts(person.handle));
    if (seen !== null) return seen;
    const page = yield* x.userPosts(person.handle, { purpose: "leads.latestPost" });
    return newestOwn(page.items);
  });

  const draftReply = Effect.fn("LeadsOps.draftReply")(function* (post: XPost, tone?: ReplyTone) {
    const drafts = yield* assist
      .generate({
        task: "leads.draftReply",
        tone,
        instructions:
          "Write 3 different replies (each under 240 characters) to this post. Each adds something: a specific observation, a question or a short related experience. No flattery, no pitch, no links, no hashtags.",
        input: { author: post.author.handle, post: post.text },
        output: Drafts,
      })
      .pipe(Effect.mapError(assistFail("draftReply")));
    return texts(drafts);
  });

  const sendReply = Effect.fn("LeadsOps.sendReply")(function* (
    personId: number,
    postId: string,
    text: string,
  ) {
    // Looked up before posting: a reply that went out must not end in an error the user retries.
    const person = yield* people.get(personId);
    // Free first: a clicked reply goes through the user's own session while that lane is on.
    const { sessionPostingEnabled } = yield* settings.get.pipe(
      Effect.orElseSucceed(() => ({ sessionPostingEnabled: false })),
    );
    const created = sessionPostingEnabled
      ? yield* session
          .post({ text, mediaPaths: [], replyToPostId: postId, paced: true })
          .pipe(
            Effect.mapError(
              (e) => new LeadsError({ operation: "reply", detail: e.message, cause: e }),
            ),
          )
      : yield* x.createPost({ text, replyToPostId: postId, purpose: "leads.reply" });
    yield* people.logActivity(personId, "replied", text.slice(0, 140));
    yield* markContacted(person);
    return { postId: created.postId };
  });

  return LeadsOps.of({
    profile,
    draftDm,
    sendDm,
    listPreview,
    newFollowers,
    engagers,
    latestPost,
    draftReply,
    sendReply,
  });
});

export const layer = Layer.effect(LeadsOps, make);

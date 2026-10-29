import type { DesktopCommand } from "@xtend/contracts";
import { describe, expect, it } from "@effect/vitest";
import type { Candidate, XFollower, XPost, XProfile } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Assist from "../ai/Assist.ts";
import * as Events from "../events/Events.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as SessionPosting from "../compose/SessionPosting.ts";
import { desktopStub } from "../compose/testStubs.ts";
import * as XClient from "../x/XClient.ts";
import * as LeadsOps from "./LeadsOps.ts";
import * as PeopleStore from "./PeopleStore.ts";
import * as XExtra from "./XExtra.ts";

const dms: Array<{ readonly to: string; readonly text: string }> = [];
const posted: Array<XClient.CreatePostInput> = [];
const profileReads: Array<string> = [];
const followerReads: Array<{ readonly handle: string; readonly fresh: boolean | undefined }> = [];
let followerPage: ReadonlyArray<XFollower> = [];
let followersFromCache = false;
let timeline: ReadonlyArray<XPost> = [];

const follower = (userId: string, handle: string): XFollower => ({
  userId,
  handle,
  name: handle,
  followers: 1_000,
  following: 10,
  verified: false,
  bio: "",
  createdAt: null,
});

const profileOf = (handle: string, bio = "builds things"): XProfile => ({
  userId: "42",
  handle,
  name: handle,
  bio,
  followers: 500,
  following: 10,
  posts: 5,
  verified: false,
  avatarUrl: null,
  createdAt: null,
  location: null,
  website: null,
});

const postBy = (postId: string, handle: string, followers: number | null): XPost => ({
  postId,
  url: `https://x.com/${handle}/status/${postId}`,
  text: "shipping a rust parser",
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: "en",
  isReply: false,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: postId, handle, name: handle, followers, verified: false, avatarUrl: null },
  metrics: { views: 10, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const candidate = (handle: string): Candidate => ({
  handle,
  name: handle,
  userId: null,
  followers: 100,
  bio: "",
});

const assistStub = Layer.succeed(Assist.Assist)({ generate: () => Effect.die("no model here") });
const xExtraStub = Layer.succeed(XExtra.XExtra)({
  engagers: () => Effect.succeed({ matches: [candidate("carol"), candidate("ada")], costUsd: 0.2 }),
  unrepost: () => Effect.die("unused"),
  unlike: () => Effect.die("unused"),
  follow: () => Effect.die("unused"),
  unfollow: () => Effect.die("unused"),
});

const desktopCalls: Array<DesktopCommand> = [];
const eventsStub = Layer.succeed(Events.Events)({ publish: () => Effect.void } as never);
const layerTest = LeadsOps.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      PeopleStore.layer,
      SessionPosting.layer,
      ObservationStore.layer,
      assistStub,
      xExtraStub,
    ),
  ),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      eventsStub,
      desktopStub(
        desktopCalls,
        (command) =>
          Effect.succeed(
            command.type === "sessionPost"
              ? { type: "sessionPost", postId: "900" }
              : { type: command.type },
          ) as never,
      ),
      xClientStub({
        profile: (handle) =>
          Effect.sync(() => {
            profileReads.push(handle);
            return profileOf(handle, handle === "ada" ? "Rust at work" : "go and k8s");
          }),
        sendDm: (to, text) => Effect.sync(() => void dms.push({ to, text })),
        userPosts: () =>
          Effect.sync(() => ({ items: timeline, nextCursor: null, fromCache: false })),
        followers: (handle, options) =>
          Effect.sync(() => {
            followerReads.push({ handle, fresh: options.fresh });
            return { items: followerPage, nextCursor: null, fromCache: followersFromCache };
          }),
        createPost: (input) =>
          Effect.sync(() => {
            posted.push(input);
            return { postId: "900", costUsd: 0.015 };
          }),
        searchPosts: () =>
          Effect.succeed({
            items: [
              postBy("1", "ada", 120),
              postBy("2", "ada", 120),
              postBy("3", "bob", 5),
              postBy("4", "carol", 300),
              postBy("5", "dave", 2_000_000),
              postBy("6", "erin", 800),
            ],
            nextCursor: null,
            fromCache: false,
          }),
      }),
    ),
  ),
);

const reset = Effect.sync(() => {
  dms.length = 0;
  posted.length = 0;
  profileReads.length = 0;
  followerReads.length = 0;
  followersFromCache = false;
});

describe("LeadsOps", () => {
  it.effect("DMs the person's X id, looked up once when unknown, and only moves a new lead", () =>
    Effect.gen(function* () {
      yield* reset;
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      const alice = yield* people.add({ ...candidate("alice"), source: "manual" });
      yield* ops.sendDm(alice.id, "hey, loved the parser post");
      expect(dms).toEqual([{ to: "42", text: "hey, loved the parser post" }]);
      const after = yield* people.get(alice.id);
      expect([after.userId, after.stage]).toEqual(["42", "contacted"]);
      expect((yield* people.activity(alice.id)).map((a) => a.kind)).toContain("dm");

      yield* ops.sendDm(alice.id, "following up");
      expect(profileReads).toEqual(["alice"]);

      const customer = yield* people.add({ ...candidate("bob"), source: "manual" });
      yield* people.update({ id: customer.id, stage: "customer" });
      yield* ops.sendDm(customer.id, "thanks for buying");
      expect((yield* people.get(customer.id)).stage).toBe("customer");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a reply for an unknown person before posting, and keeps a replied lead", () =>
    Effect.gen(function* () {
      yield* reset;
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      expect(yield* Effect.flip(ops.sendReply(999, "5", "nice"))).toMatchObject({
        _tag: "LeadsError",
      });
      expect(posted).toEqual([]);

      // Free first: the clicked reply goes through the session while that lane is on.
      const p = yield* people.add({ ...candidate("carol"), source: "manual" });
      yield* people.update({ id: p.id, stage: "replied" });
      expect(yield* ops.sendReply(p.id, "5", "same here")).toEqual({ postId: "900" });
      expect(desktopCalls.map((c) => c.type)).toEqual(["sessionPost"]);
      expect(posted).toEqual([]);
      expect((yield* people.get(p.id)).stage).toBe("replied");

      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ sessionPostingEnabled: false });
      yield* ops.sendReply(p.id, "6", "and this");
      expect(posted.map((x) => [x.replyToPostId, x.text])).toEqual([["6", "and this"]]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("previews each author once, minus ignored people, inside the follower bounds", () =>
    Effect.gen(function* () {
      yield* reset;
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      const carol = yield* people.add({ ...candidate("Carol"), source: "manual" });
      yield* people.update({ id: carol.id, stage: "ignored" });

      const plain = yield* ops.listPreview({
        query: "rust",
        minFollowers: 10,
        maxFollowers: 10_000,
      });
      expect(plain.matches.map((m) => m.handle)).toEqual(["ada", "erin"]);
      expect(plain.costUsd).toBe(XClient.RATE_CARD.searchPage);
      expect(profileReads).toEqual([]);

      // A bio filter pays one profile read per remaining author, and the quote says so.
      const byBio = yield* ops.listPreview({ query: "rust", minFollowers: 10, bioKeyword: "RUST" });
      expect(byBio.matches.map((m) => [m.handle, m.bio])).toEqual([["ada", "Rust at work"]]);
      expect(profileReads).toEqual(["ada", "dave", "erin"]);
      expect(byBio.costUsd).toBeCloseTo(
        XClient.RATE_CARD.searchPage + 3 * XClient.RATE_CARD.scraperProfile,
      );

      expect((yield* ops.engagers("77", "like")).matches.map((m) => m.handle)).toEqual(["ada"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("calls only unseen followers new, reads a fresh page, and is free from the cache", () =>
    Effect.gen(function* () {
      yield* reset;
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      const settings = yield* SettingsStore.SettingsStore;
      expect(yield* Effect.flip(ops.newFollowers)).toMatchObject({ _tag: "LeadsError" });
      expect(followerReads).toEqual([]);

      yield* settings.update({ handle: "siam" });
      yield* people.add({ ...candidate("bob"), source: "manual" });
      followerPage = [follower("1", "ada"), follower("2", "bob")];
      const first = yield* ops.newFollowers;
      expect(first.followers.map((f) => [f.handle, f.inPeople])).toEqual([
        ["ada", false],
        ["bob", true],
      ]);
      expect(first.costUsd).toBe(XClient.RATE_CARD.followersPage);
      // A check asks for minutes-old data: a 12-hour copy would hide everyone who followed since.
      expect(followerReads).toEqual([{ handle: "siam", fresh: true }]);

      yield* TestClock.adjust("15 minutes");
      followerPage = [follower("3", "cara"), ...followerPage];
      expect((yield* ops.newFollowers).followers.map((f) => f.handle)).toEqual(["cara"]);

      followersFromCache = true;
      const cached = yield* ops.newFollowers;
      expect(cached.followers.map((f) => f.handle)).toEqual(["cara"]);
      expect(cached.costUsd).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("replies to the person's own newest post, never to one they only reposted", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      const ada = yield* people.add({ ...candidate("ada"), source: "manual" });
      const repost = { ...postBy("7", "ada", 120), isRepost: true };
      const reply = { ...postBy("8", "ada", 120), isReply: true };
      timeline = [repost, reply, postBy("9", "ada", 120)];
      expect((yield* ops.latestPost(ada.id))?.postId).toBe("9");
      timeline = [repost, reply];
      expect((yield* ops.latestPost(ada.id))?.postId).toBe("8");
      timeline = [repost];
      expect(yield* ops.latestPost(ada.id)).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("takes their latest post from what the session saw, free; X only when asked", () =>
    Effect.gen(function* () {
      const people = yield* PeopleStore.PeopleStore;
      const ops = yield* LeadsOps.LeadsOps;
      const observations = yield* ObservationStore.ObservationStore;
      const bo = yield* people.add({ ...candidate("bo"), source: "manual" });
      timeline = [postBy("30", "bo", 60)];
      yield* observations.record({
        viewerHandle: null,
        source: "profile",
        observedAt: "2026-10-22T05:00:00.000Z",
        posts: [
          {
            postId: "21",
            author: { userId: "u-bo", handle: "bo", name: "Bo", followers: 10, verified: false },
            text: "seen by the session",
            createdAt: "2026-10-22T04:00:00.000Z",
            isReply: false,
            isRepost: false,
            isPromoted: false,
            hasMedia: false,
            hasLink: false,
            metrics: { views: 5, likes: 1, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
          },
        ],
      });
      expect((yield* ops.latestPost(bo.id))?.postId).toBe("21");
      expect((yield* ops.latestPost(bo.id, true))?.postId).toBe("30");
    }).pipe(Effect.provide(layerTest)),
  );
});

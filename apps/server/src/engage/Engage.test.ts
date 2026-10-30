import { describe, expect, it } from "@effect/vitest";
import {
  type DesktopCommand,
  DesktopUnavailableError,
  type ObservationBatch,
  XApiError,
  type XPost,
} from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as Assist from "../ai/Assist.ts";
import * as SessionPosting from "../compose/SessionPosting.ts";
import { desktopStub } from "../compose/testStubs.ts";
import * as Events from "../events/Events.ts";
import * as ObservationStore from "../observations/ObservationStore.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import * as Treg from "../x/Treg.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import { DM_EVENTS_QUOTE_USD } from "./DmEvents.ts";
import * as Engage from "./Engage.ts";
import * as EngageStore from "./EngageStore.ts";

const mention = (postId: string): XPost => ({
  postId,
  url: `https://x.com/a/status/${postId}`,
  text: "@siam hi",
  createdAt: "2026-10-22T09:00:00.000Z",
  lang: null,
  isReply: true,
  isRepost: false,
  hasMedia: false,
  hasLink: false,
  author: { userId: "2", handle: "a", name: "A", followers: 1, verified: false, avatarUrl: null },
  metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
});

const target = (postId: string, handle: string): XPost => ({
  ...mention(postId),
  url: `https://x.com/${handle}/status/${postId}`,
  text: "how do you price an api?",
  isReply: false,
  author: { ...mention(postId).author, userId: postId, handle },
  metrics: { ...mention(postId).metrics, views: 1000 },
});

const apiCalls: Array<string | undefined> = [];
/** Texts sent to X's create-post endpoint, the paid lane. */
const postedTexts: Array<string> = [];
const apiLikes: Array<string> = [];
const published: Array<Events.EventInput> = [];
const eventsStub = Layer.succeed(Events.Events)({
  publish: (event) =>
    Effect.sync(() => {
      published.push(event);
    }),
  stream: Stream.empty,
});
const tregCalls: Array<Treg.TregCall> = [];
// Assist echoes the tone it was asked for as the single draft, so a test can read what was asked.
const assistStub = Layer.succeed(Assist.Assist)({
  generate: (request) => Effect.succeed({ drafts: [{ text: request.tone ?? "none" }] } as never),
});
const tregStub = Layer.succeed(Treg.Treg)({
  call: (input) =>
    Effect.sync(() => {
      tregCalls.push(input);
      return { status: 200, body: { data: [] }, costUsd: 0, cached: false };
    }),
  isCached: () => Effect.succeed(false),
});

// The desktop answers a session reply with "s" plus the call count, or fails as `desktop.answer` says.
const desktopCalls: Array<DesktopCommand> = [];
const desktop = { answer: "ok" as "ok" | DesktopUnavailableError["reason"] };
const layerTest = Engage.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      EngageStore.layer,
      SessionPosting.layer,
      ObservationStore.layer,
      assistStub,
      tregStub,
      eventsStub,
    ),
  ),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      desktopStub(desktopCalls, (command) =>
        desktop.answer === "ok"
          ? (Effect.succeed(
              command.type === "sessionPost"
                ? { type: "sessionPost", postId: `${desktopCalls.length}0` }
                : { type: command.type },
            ) as never)
          : Effect.fail(new DesktopUnavailableError({ reason: desktop.answer, detail: "test" })),
      ),
      xClientStub({
        searchPosts: () =>
          Effect.succeed({
            items: [target("31", "ann"), target("32", "ben")],
            nextCursor: null,
            fromCache: false,
          }),
        createPost: ({ text }) =>
          (postedTexts.push(text), text === "fail")
            ? Effect.fail(
                new XApiError({
                  endpoint: "x/2/tweets",
                  reason: "budget",
                  status: null,
                  detail: "monthly budget reached",
                }),
              )
            : Effect.succeed({ postId: "900", costUsd: 0.015 }),
        like: (postId) => Effect.sync(() => void apiLikes.push(postId)),
        mentions: ({ sinceId }) => {
          apiCalls.push(sinceId);
          return Effect.succeed(
            sinceId === undefined ? [mention("10"), mention("12")] : [mention("15")],
          );
        },
      }),
    ),
  ),
);

describe("Engage.mentions", () => {
  it.effect("pays X only on refresh, and then only for mentions newer than the last one", () =>
    Effect.gen(function* () {
      apiCalls.length = 0;
      const engage = yield* Engage.Engage;
      expect((yield* engage.mentions(false)).mentions).toEqual([]);
      expect(apiCalls).toEqual([]);
      expect((yield* engage.mentions(true)).mentions.map((m) => m.post.postId)).toEqual([
        "12",
        "10",
      ]);
      expect((yield* engage.mentions(false)).mentions).toHaveLength(2);
      expect((yield* engage.mentions(true)).mentions.map((m) => m.post.postId)).toEqual([
        "15",
        "12",
        "10",
      ]);
      expect(apiCalls).toEqual([undefined, "12"]);
    }).pipe(Effect.provide(layerTest)),
  );
});

/** What the desktop captured: posts by `ann` with these ids and texts, an hour after the API's. */
const sessionSaw = (posts: ReadonlyArray<readonly [string, string]>): ObservationBatch => ({
  viewerHandle: "siam",
  source: "home",
  observedAt: "2026-10-22T11:00:00.000Z",
  posts: posts.map(([postId, text]) => ({
    postId,
    author: { userId: "2", handle: "ann", name: "Ann", followers: 10, verified: false },
    text,
    createdAt: "2026-10-22T10:00:00.000Z",
    isReply: true,
    isRepost: false,
    isPromoted: false,
    hasMedia: false,
    hasLink: false,
    metrics: { views: null, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 },
  })),
});

describe("Engage.mentions, session", () => {
  it.effect(
    "adds what the session saw tagging the handle, once beside X's copy, newest first",
    () =>
      Effect.gen(function* () {
        yield* (yield* SettingsStore.SettingsStore).update({ handle: "siam" });
        const engage = yield* Engage.Engage;
        const store = yield* EngageStore.EngageStore;
        yield* (yield* ObservationStore.ObservationStore).record(
          sessionSaw([
            ["12", "@siam hi"],
            ["20", "@Siam ship it"],
            ["21", "@siamships is someone else"],
          ]),
        );
        yield* store.setHandled(["12", "10"], true);
        const { mentions } = yield* engage.mentions(true);
        expect(mentions.map((m) => [m.post.postId, m.source, m.handled])).toEqual([
          ["20", "session", false],
          ["12", "api", true],
          ["10", "api", true],
        ]);
        // Reopened together, both are open again.
        yield* store.setHandled(["12", "10"], false);
        const reopened = (yield* engage.mentions(false)).mentions;
        expect(reopened.filter((m) => m.handled)).toEqual([]);
      }).pipe(Effect.provide(layerTest)),
  );
});

describe("Engage.inbox", () => {
  it.effect(
    "announces each incoming reply once per account, however often the service restarts",
    () =>
      Effect.gen(function* () {
        published.length = 0;
        const sql = yield* SqlClient.SqlClient;
        const observations = yield* ObservationStore.ObservationStore;
        yield* (yield* SettingsStore.SettingsStore).update({ handle: "siam" });
        // Each read builds the service afresh over the same database, as a restart does.
        const inbox = Effect.flatMap(Engage.Engage, (e) => e.inbox).pipe(
          Effect.provide(Layer.fresh(Engage.layer)),
        );
        const announced = () =>
          published.filter((e) => e.type === "mention_arrived").map((e) => e.payload?.["count"]);

        yield* observations.record(
          sessionSaw([
            ["40", "@siam nice"],
            ["41", "@siam agreed"],
          ]),
        );
        yield* inbox;
        yield* inbox;
        expect(announced()).toEqual([2]);
        yield* observations.record(sessionSaw([["42", "@siam one more"]]));
        yield* inbox;
        expect(announced()).toEqual([2, 1]);

        // The same replies seen from a second account are news to that account.
        yield* sql`UPDATE settings SET current_account_id = 2 WHERE id = 1`;
        yield* observations.record({
          ...sessionSaw([["40", "@siam nice"]]),
          observedAt: "2026-10-22T12:00:00.000Z",
        });
        yield* inbox;
        expect(announced()).toEqual([2, 1, 1]);
      }).pipe(Effect.provide(layerTest)),
  );
});

describe("Engage.like", () => {
  it.effect(
    "presses X's own like through the session while the lane is on; the API only when off",
    () =>
      Effect.gen(function* () {
        desktopCalls.length = 0;
        apiLikes.length = 0;
        const engage = yield* Engage.Engage;
        const settings = yield* SettingsStore.SettingsStore;
        yield* engage.like("61");
        expect(desktopCalls).toEqual([{ type: "sessionLike", postId: "61" }]);
        expect(apiLikes).toEqual([]);
        yield* settings.update({ sessionPostingEnabled: false });
        yield* engage.like("62");
        expect(apiLikes).toEqual(["62"]);
        expect(desktopCalls).toHaveLength(1);
      }).pipe(Effect.provide(layerTest)),
  );
});

describe("Engage.reply", () => {
  it.effect("goes through the session by default, at a human pace, and never pays", () =>
    Effect.gen(function* () {
      desktopCalls.length = 0;
      const engage = yield* Engage.Engage;
      const sent = yield* engage.reply(target("41", "ann"), "charge per call");
      expect([sent.postId, sent.error, postedTexts.length]).toEqual(["10", null, 0]);
      expect(desktopCalls[0]).toMatchObject({ type: "sessionPost", replyToPostId: "41" });
      // A second click right away is held, and nothing is recorded for it.
      const paced = yield* engage.reply(target("42", "ben"), "again").pipe(Effect.flip);
      expect(paced.message).toContain("Human pace");
      const store = yield* EngageStore.EngageStore;
      expect(yield* store.sentList([])).toHaveLength(1);
      // No desktop: nothing was attempted, so the user is told rather than a row kept.
      desktop.answer = "no_desktop";
      const away = yield* engage.reply(target("42", "ben"), "again").pipe(Effect.flip);
      expect([away.operation, (yield* store.sentList([])).length]).toEqual(["session", 1]);
      desktop.answer = "ok";
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps a refused reply with X's reason; only a sent one marks the target replied", () =>
    Effect.gen(function* () {
      yield* (yield* SettingsStore.SettingsStore).update({
        keywords: ["api pricing"],
        sessionPostingEnabled: false,
      });
      const engage = yield* Engage.Engage;
      const failed = yield* engage.reply(target("31", "ann"), "fail");
      expect([failed.postId, failed.error]).toEqual([null, expect.stringContaining("budget")]);
      const sent = yield* engage.reply(target("32", "ben"), "charge per call, cap per month");
      expect([sent.postId, sent.error]).toEqual(["900", null]);

      const targets = yield* engage.targets;
      const byPost = new Map(targets.map((t) => [t.post.postId, t]));
      expect([byPost.get("31")?.replied, byPost.get("31")?.repliesToAuthor]).toEqual([false, 0]);
      expect([byPost.get("32")?.replied, byPost.get("32")?.repliesToAuthor]).toEqual([true, 1]);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("Engage.dms", () => {
  it.effect("is free until asked to load, and never asks X for more events than it quoted", () =>
    Effect.gen(function* () {
      tregCalls.length = 0;
      const engage = yield* Engage.Engage;
      expect(yield* engage.dms(false)).toEqual({
        events: [],
        error: null,
        quoteUsd: DM_EVENTS_QUOTE_USD,
      });
      expect(tregCalls).toEqual([]);
      yield* engage.dms(true);
      expect(tregCalls).toHaveLength(1);
      expect(tregCalls[0]?.expectedCostUsd).toBe(DM_EVENTS_QUOTE_USD);
      // $0.01 an event: the page size times that is the most this load can cost.
      expect(Number(tregCalls[0]?.query?.max_results) * 0.01).toBeLessThanOrEqual(
        DM_EVENTS_QUOTE_USD,
      );
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("Engage.draftReply", () => {
  it.effect("asks for the chosen tone, and for none when the user picked none", () =>
    Effect.gen(function* () {
      const engage = yield* Engage.Engage;
      const plain = yield* engage.draftReply(target("51", "ann"));
      const dry = yield* engage.draftReply(target("51", "ann"), "sarcastic");
      expect(plain[0]?.text).toBe("none");
      expect(dry[0]?.text).toBe("sarcastic");
    }).pipe(Effect.provide(layerTest)),
  );
});

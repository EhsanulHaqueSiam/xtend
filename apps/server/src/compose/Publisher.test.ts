import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  type DesktopCommand,
  DesktopUnavailableError,
  type DraftPatch,
  XApiError,
} from "@xtend/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as Articles from "./Articles.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as SessionPosting from "./SessionPosting.ts";
import { desktopStub } from "./testStubs.ts";

// Records every post X accepted. Text with "boom" is refused by X, "noid" is accepted without an
// id, "lost" times out and "garbled" gets an unreadable 200 (either may be on X), and "crash" dies
// while `crash.on` is set, as a bug in the client would. The desktop answers per `desktop.answer`.
const calls: Array<{ readonly text: string; readonly replyToPostId: string | undefined }> = [];
const crash = { on: false };
const desktop = { answer: "ok" as "ok" | DesktopUnavailableError["reason"] };
const desktopCalls: Array<DesktopCommand> = [];
const unsure = { lost: "http", garbled: "decode" } as const;
// How an article publish fails; unset, it dies, so a test that reaches it unasked fails.
const article = { failure: null as XApiError | null };
// Completed by the next post X accepts, and by the next draft marked posted: a test whose caller
// leaves mid-thread waits on these instead of on time.
const next = {
  post: null as Deferred.Deferred<void> | null,
  posted: null as Deferred.Deferred<void> | null,
};
const draftsWatched = Layer.effect(
  DraftStore.DraftStore,
  Effect.gen(function* () {
    const drafts = yield* DraftStore.DraftStore;
    return DraftStore.DraftStore.of({
      ...drafts,
      setOutcome: (id, outcome) =>
        drafts
          .setOutcome(id, outcome)
          .pipe(
            Effect.tap(() =>
              outcome.status === "posted" && next.posted !== null
                ? Deferred.succeed(next.posted, undefined)
                : Effect.void,
            ),
          ),
    });
  }),
).pipe(Layer.provide(DraftStore.layer));
const articlesFake = Layer.succeed(Articles.Articles)({
  publish: () =>
    article.failure === null
      ? Effect.die("articles not stubbed for this test")
      : Effect.fail(article.failure),
  generateCover: () => Effect.die("articles not stubbed for this test"),
  quote: { articleUsd: 0, coverUsd: 0, coverModel: "stub" },
});
const layerTest = Publisher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(draftsWatched, SessionPosting.layer, articlesFake)),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      NodeCrypto.layer,
      TokenCipher.layerTest,
      Events.layer,
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
        createPost: (input) =>
          Effect.gen(function* () {
            // Lets a racing publisher run between posts.
            yield* Effect.yieldNow;
            if (crash.on && input.text.includes("crash")) return yield* Effect.die("client bug");
            if (input.text.includes("boom"))
              return yield* new XApiError({
                endpoint: "x/2/tweets",
                reason: "provider",
                status: 403,
                detail: "Your post is too long",
              });
            for (const [word, reason] of Object.entries(unsure))
              if (input.text.includes(word))
                return yield* new XApiError({
                  endpoint: "x/2/tweets",
                  reason,
                  status: null,
                  detail: word,
                });
            calls.push({ text: input.text, replyToPostId: input.replyToPostId });
            if (next.post !== null) yield* Deferred.succeed(next.post, undefined);
            return { postId: input.text.includes("noid") ? "" : String(calls.length), costUsd: 0 };
          }),
      }),
    ),
  ),
);

const reset = () => {
  calls.length = 0;
  desktopCalls.length = 0;
  crash.on = false;
  desktop.answer = "ok";
  article.failure = null;
  next.post = null;
  next.posted = null;
};

/** What the Compose editor sends on every autosave: every field, changed or not. */
const editorPatch = (blocks: ReadonlyArray<string>): DraftPatch => ({
  kind: "thread",
  blocks: blocks.map((text) => ({ text })),
  title: "",
  body: "",
  replySettings: "everyone",
  poll: null,
  hideLinkPreviews: false,
  threadDelaySeconds: 0,
  quoteUrl: null,
  replyToPostId: null,
  media: [],
});

const postNow = { purpose: "compose.postNow", retry: false } as const;
const scheduled = { purpose: "plan.scheduler", retry: true } as const;

describe("Publisher", () => {
  it.effect("posts a draft once however many publishers race for it", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ blocks: [{ text: "one" }, { text: "two" }] });
      // Post now and the scheduler, at the same instant.
      const results = yield* Effect.all(
        [
          Effect.result(publisher.post(d.id, postNow)),
          Effect.result(publisher.post(d.id, { purpose: "plan.scheduler", retry: true })),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(calls.map((c) => c.text)).toEqual(["one", "two"]);
      const posted = yield* drafts.get(d.id);
      expect(posted.status).toBe("posted");
      // Posted is final: the editor is locked and a third attempt is refused.
      expect((yield* Effect.result(drafts.update(d.id, { blocks: [{ text: "x" }] })))._tag).toBe(
        "Failure",
      );
      expect(
        (yield* Effect.result(publisher.post(d.id, { purpose: "plan.runNow", retry: true })))._tag,
      ).toBe("Failure");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("fixing the post that failed resumes the thread instead of reposting it", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create(editorPatch(["one", "two", "boom"]));
      const failed = yield* publisher.post(d.id, postNow);
      expect(failed.status).toBe("failed");
      expect(failed.postIds).toEqual(["1", "2"]);

      // An autosave that changes nothing keeps the failure on screen.
      const same = yield* drafts.update(d.id, editorPatch(["one", "two", "boom"]));
      expect(same.error).toContain("too long");
      expect(same.attempts).toBe(1);

      const fixed = yield* drafts.update(d.id, editorPatch(["one", "two", "three"]));
      expect(fixed.postIds).toEqual(["1", "2"]);
      expect(fixed.error).toBeNull();
      const done = yield* publisher.post(d.id, postNow);
      expect(done.status).toBe("posted");
      expect(done.postIds).toEqual(["1", "2", "3"]);
      expect(calls).toEqual([
        { text: "one", replyToPostId: undefined },
        { text: "two", replyToPostId: "1" },
        { text: "three", replyToPostId: "2" },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("editing a post that is already on X starts the thread over", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create(editorPatch(["one", "boom"]));
      yield* publisher.post(d.id, postNow);
      const rewritten = yield* drafts.update(d.id, editorPatch(["one, rewritten", "two"]));
      expect(rewritten.postIds).toEqual([]);
      expect(rewritten.attempts).toBe(0);
      const done = yield* publisher.post(d.id, postNow);
      expect(done.postIds).toEqual(["2", "3"]);
      expect(calls.slice(1).map((c) => c.replyToPostId)).toEqual([undefined, "2"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a thread keeps posting after the caller goes away", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ blocks: [{ text: "a" }, { text: "b" }, { text: "c" }] });
      const firstPost = yield* Deferred.make<void>();
      const allPosted = yield* Deferred.make<void>();
      next.post = firstPost;
      next.posted = allPosted;
      // The tab closes once the first post is out.
      const caller = yield* Effect.forkChild(publisher.post(d.id, postNow));
      yield* Deferred.await(firstPost);
      next.post = null;
      yield* Fiber.interrupt(caller);
      yield* Deferred.await(allPosted);
      const after = yield* drafts.get(d.id);
      expect(after.status).toBe("posted");
      expect(calls.map((c) => c.text)).toEqual(["a", "b", "c"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a crash mid-thread leaves it failed with what went out, and a retry resumes", () =>
    Effect.gen(function* () {
      reset();
      crash.on = true;
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ blocks: [{ text: "one" }, { text: "crash" }] });
      expect(Exit.isFailure(yield* Effect.exit(publisher.post(d.id, postNow)))).toBe(true);
      const stuck = yield* drafts.get(d.id);
      expect(stuck.status).toBe("failed");
      expect(stuck.postIds).toEqual(["1"]);
      expect(stuck.error).toContain("client bug");

      crash.on = false;
      const done = yield* publisher.post(d.id, postNow);
      expect(done.status).toBe("posted");
      expect(calls.map((c) => c.text)).toEqual(["one", "crash"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a post that may be on X stops the thread and is never retried on its own", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      // A timeout, an unreadable 200 and a 200 without an id: each was paid for and may be on X.
      for (const second of ["lost", "garbled", "noid"]) {
        const d = yield* drafts.create({
          blocks: [{ text: "one" }, { text: second }, { text: "three" }],
        });
        const out = yield* publisher.post(d.id, scheduled);
        expect(out.status).toBe("failed");
        expect(out.error).toContain("Post 2 may already be on X");
        expect(out.postIds).toHaveLength(1);
      }
      expect(calls.map((c) => c.text)).not.toContain("three");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "a session post the desktop never got or refused untouched is retried; one it went quiet or failed on is not",
    () =>
      Effect.gen(function* () {
        reset();
        const drafts = yield* DraftStore.DraftStore;
        const publisher = yield* Publisher.Publisher;
        const settings = yield* SettingsStore.SettingsStore;
        yield* settings.update({ sessionPostingEnabled: true });
        const mediaDraft = Effect.gen(function* () {
          const d = yield* drafts.create({ blocks: [{ text: "look" }] });
          yield* drafts.mediaInsert(d.id, {
            id: `m-${d.id}`,
            blockIndex: 0,
            path: "/m/a.png",
            kind: "image",
            alt: "",
          });
          return d;
        });

        const d = yield* mediaDraft;
        desktop.answer = "no_desktop";
        const asleep = yield* publisher.post(d.id, scheduled);
        expect(asleep.status).toBe("queued");
        // Session posting off on the desktop, or its time ran out in the desktop's queue.
        desktop.answer = "not_attempted";
        const refused = yield* publisher.post(d.id, scheduled);
        expect([refused.status, refused.attempts]).toEqual(["queued", 2]);
        expect(refused.error).not.toContain("may already be on X");

        for (const answer of ["timeout", "failed"] as const) {
          desktop.answer = answer;
          const touched = yield* publisher.post((yield* mediaDraft).id, scheduled);
          expect([touched.status, touched.attempts]).toEqual(["failed", 1]);
          expect(touched.error).toContain("Post 1 may already be on X");
        }
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("says a link card it was asked to hide was kept, and touches no session for it", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const settings = yield* SettingsStore.SettingsStore;
      yield* settings.update({ sessionPostingEnabled: true });
      const link = { blocks: [{ text: "read https://example.com/a" }], hideLinkPreviews: true };

      const out = yield* publisher.post((yield* drafts.create(link)).id, postNow);
      expect(out.status).toBe("posted");
      expect(out.linkPreviewNote).toBe("Link preview kept: Xtend cannot hide it yet");
      expect(desktopCalls).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a draft X would reject partway before anything goes to X", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const refused = (patch: DraftPatch) =>
        Effect.gen(function* () {
          const d = yield* drafts.create(patch);
          const out = yield* publisher.post(d.id, postNow);
          expect(out.status).toBe("failed");
          return out.error;
        });

      expect(
        yield* refused({
          blocks: [{ text: "vote" }],
          poll: { options: ["yes", " "], durationMinutes: 60 },
        }),
      ).toContain("blank option");
      expect(yield* refused({ blocks: [{ text: "one" }, { text: "  " }, { text: "three" }] })).toBe(
        "Post 2 is empty",
      );
      expect(yield* refused({ blocks: [{ text: "" }] })).toBe("Nothing to post");
      // X's weighting: the CJK second post is 141 characters counted 2 each.
      expect(yield* refused({ blocks: [{ text: "fits" }, { text: "語".repeat(141) }] })).toBe(
        "Post 2 is over 280 characters",
      );

      const withImage = yield* drafts.create({
        blocks: [{ text: "vote" }],
        poll: { options: ["yes", "no"], durationMinutes: 60 },
      });
      yield* drafts.mediaInsert(withImage.id, {
        id: "img",
        blockIndex: 0,
        path: "/m/a.png",
        kind: "image",
        alt: "",
      });
      const out = yield* publisher.post(withImage.id, postNow);
      expect(out.error).toContain("poll cannot share");
      expect(calls).toHaveLength(0);
      expect(desktopCalls).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("an article already published by a failed attempt is not published again", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ kind: "article", title: "T", body: "b" });
      // The publish went out, then the attempt failed before it was marked posted.
      yield* drafts.setOutcome(d.id, { status: "failed", articleId: "5", postIds: ["77"] });
      // The articles fake dies on publish here, so reaching it fails the test.
      const out = yield* publisher.post(d.id, postNow);
      expect(out.status).toBe("posted");
      expect(out.postIds).toEqual(["77"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "an article publish that timed out may be live, so the scheduler never retries it",
    () =>
      Effect.gen(function* () {
        reset();
        const drafts = yield* DraftStore.DraftStore;
        const publisher = yield* Publisher.Publisher;
        const d = yield* drafts.create({ kind: "article", title: "T", body: "b" });
        article.failure = new XApiError({
          endpoint: "x/articles/publish",
          reason: "http",
          status: null,
          detail: "no answer",
        });
        const out = yield* publisher.post(d.id, scheduled);
        expect(out.status).toBe("failed");
        expect(out.error).toContain("Post 1 may already be on X");
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "a clicked text post goes through the x.com session while the lane is on; a scheduled one takes the API",
    () =>
      Effect.gen(function* () {
        reset();
        const publisher = yield* Publisher.Publisher;
        const drafts = yield* DraftStore.DraftStore;
        const clicked = yield* drafts.create({ blocks: [{ text: "hello" }, { text: "again" }] });
        yield* publisher.post(clicked.id, { ...postNow, clicked: true });
        expect(desktopCalls.map((c) => c.type)).toEqual(["sessionPost", "sessionPost"]);
        expect(calls).toEqual([]);

        const scheduled = yield* drafts.create({ blocks: [{ text: "later" }] });
        yield* publisher.post(scheduled.id, { purpose: "plan.scheduler", retry: false });
        expect(calls.map((c) => c.text)).toEqual(["later"]);

        // X's own composer sets a poll and who can reply as part of the click, so both stay free.
        const poll = yield* drafts.create({
          blocks: [{ text: "which?" }],
          poll: { options: ["a", "b"], durationMinutes: 60 },
          replySettings: "following",
        });
        desktopCalls.length = 0;
        yield* publisher.post(poll.id, { ...postNow, clicked: true, sessionOnly: true });
        expect(desktopCalls).toEqual([
          {
            type: "sessionPost",
            text: "which?",
            mediaPaths: [],
            replySettings: "following",
            poll: { options: ["a", "b"], durationMinutes: 60 },
          },
        ]);
        // Unattended, the same draft takes the API with both settings.
        const later = yield* drafts.create({
          blocks: [{ text: "vote later" }],
          poll: { options: ["a", "b"], durationMinutes: 60 },
        });
        yield* publisher.post(later.id, { purpose: "plan.scheduler", retry: false });
        expect(calls.map((c) => c.text)).toEqual(["later", "vote later"]);
        expect(desktopCalls).toHaveLength(1);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "a session-only post is refused while the session lane is off, never sent through the API",
    () =>
      Effect.gen(function* () {
        reset();
        const publisher = yield* Publisher.Publisher;
        const drafts = yield* DraftStore.DraftStore;
        const settings = yield* SettingsStore.SettingsStore;
        yield* settings.update({ sessionPostingEnabled: false });
        const draft = yield* drafts.create({ blocks: [{ text: "hello" }] });
        const after = yield* publisher.post(draft.id, {
          ...postNow,
          clicked: true,
          sessionOnly: true,
        });
        expect(after.status).toBe("failed");
        expect(calls).toEqual([]);
        expect(desktopCalls).toEqual([]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("blocks with media go through the x.com session, only when the setting is on", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const settings = yield* SettingsStore.SettingsStore;
      const d = yield* drafts.create({
        blocks: [{ text: "look" }, { text: "plain" }],
        quoteUrl: "https://x.com/levelsio/status/7",
      });
      yield* drafts.mediaInsert(d.id, {
        id: "m",
        blockIndex: 0,
        path: "/m/a.png",
        kind: "image",
        alt: "",
      });

      yield* settings.update({ sessionPostingEnabled: false });
      const off = yield* publisher.post(d.id, postNow);
      expect(off.status).toBe("failed");
      expect(off.error).toContain("Session actions are off");
      expect(desktopCalls).toHaveLength(0);
      expect(calls).toHaveLength(0);

      yield* settings.update({ sessionPostingEnabled: true });
      const on = yield* publisher.post(d.id, postNow);
      expect(on.status).toBe("posted");
      // The quote link rides on the first post; the second is a plain API reply to the session post.
      expect(desktopCalls).toEqual([
        {
          type: "sessionPost",
          text: "look\nhttps://x.com/levelsio/status/7",
          mediaPaths: ["/m/a.png"],
        },
      ]);
      expect(calls).toEqual([{ text: "plain", replyToPostId: "10" }]);
      expect(on.postIds).toEqual(["10", "1"]);

      // A post may be only its image, and X's composer limits who replies to it.
      const photo = yield* drafts.create({ blocks: [{ text: "" }], replySettings: "verified" });
      yield* drafts.mediaInsert(photo.id, {
        id: "p",
        blockIndex: 0,
        path: "/m/p.png",
        kind: "image",
        alt: "",
      });
      expect((yield* publisher.post(photo.id, postNow)).status).toBe("posted");
      expect(desktopCalls.at(-1)).toEqual({
        type: "sessionPost",
        text: "",
        mediaPaths: ["/m/p.png"],
        replySettings: "verified",
      });
    }).pipe(Effect.provide(layerTest)),
  );
});

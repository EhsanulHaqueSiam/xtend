import { describe, expect, it } from "@effect/vitest";
import {
  type DesktopCommand,
  DesktopUnavailableError,
  type DraftPatch,
  XApiError,
} from "@xtend/contracts";
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
const articlesFake = Layer.succeed(Articles.Articles)({
  publish: () =>
    article.failure === null
      ? Effect.die("articles not stubbed for this test")
      : Effect.fail(article.failure),
  generateCover: () => Effect.die("articles not stubbed for this test"),
  quote: { articleUsd: 0, coverUsd: 0, coverModel: "stub" },
});
const layerTest = Publisher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(DraftStore.layer, SessionPosting.layer, articlesFake)),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
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
            yield* Effect.sleep("10 millis");
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
  it.live("posts a draft once however many publishers race for it", () =>
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

  it.live("fixing the post that failed resumes the thread instead of reposting it", () =>
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

  it.live("editing a post that is already on X starts the thread over", () =>
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

  it.live("a thread keeps posting after the caller goes away", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ blocks: [{ text: "a" }, { text: "b" }, { text: "c" }] });
      // The tab closes once the first post is out.
      const caller = yield* Effect.forkChild(publisher.post(d.id, postNow));
      while (calls.length === 0) yield* Effect.sleep("2 millis");
      yield* Fiber.interrupt(caller);
      while ((yield* drafts.get(d.id)).status === "posting") yield* Effect.sleep("5 millis");
      const after = yield* drafts.get(d.id);
      expect(after.status).toBe("posted");
      expect(calls.map((c) => c.text)).toEqual(["a", "b", "c"]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("a crash mid-thread leaves it failed with what went out, and a retry resumes", () =>
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

  it.live("a post that may be on X stops the thread and is never retried on its own", () =>
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

  it.live(
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

  it.live("hiding a link card uses the x.com session only when Session posting is on", () =>
    Effect.gen(function* () {
      reset();
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const settings = yield* SettingsStore.SettingsStore;
      const link = { blocks: [{ text: "read https://example.com/a" }], hideLinkPreviews: true };

      yield* settings.update({ sessionPostingEnabled: false });
      const off = yield* publisher.post((yield* drafts.create(link)).id, postNow);
      expect(off.status).toBe("posted");
      expect(off.linkPreviewNote).toContain("Session actions are off");
      expect(desktopCalls).toHaveLength(0);

      yield* settings.update({ sessionPostingEnabled: true });
      const on = yield* publisher.post((yield* drafts.create(link)).id, postNow);
      expect(on.linkPreviewNote).toContain("requested");
      expect(desktopCalls).toEqual([
        { type: "sessionNavigate", url: `https://x.com/i/web/status/${on.postIds[0]}` },
      ]);
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

      const limited = yield* drafts.create({
        blocks: [{ text: "pic" }],
        replySettings: "following",
      });
      yield* drafts.mediaInsert(limited.id, {
        id: "img2",
        blockIndex: 0,
        path: "/m/b.png",
        kind: "image",
        alt: "",
      });
      expect((yield* publisher.post(limited.id, postNow)).error).toContain("limit who replies");
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

  it.live("blocks with media go through the x.com session, only when the setting is on", () =>
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

      // A post may be only its image.
      const photo = yield* drafts.create({ blocks: [{ text: "" }] });
      yield* drafts.mediaInsert(photo.id, {
        id: "p",
        blockIndex: 0,
        path: "/m/p.png",
        kind: "image",
        alt: "",
      });
      expect((yield* publisher.post(photo.id, postNow)).status).toBe("posted");
    }).pipe(Effect.provide(layerTest)),
  );
});

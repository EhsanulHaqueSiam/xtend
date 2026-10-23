import { describe, expect, it } from "@effect/vitest";
import type { DesktopCommand } from "@xtend/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as SettingsStore from "../settings/SettingsStore.ts";
import * as TokenCipher from "../settings/TokenCipher.ts";
import { xClientStub } from "../testing/xClientStub.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Publisher from "./Publisher.ts";
import * as SessionPosting from "./SessionPosting.ts";
import { articlesStub, desktopStub } from "./testStubs.ts";

const calls: Array<string> = [];
const desktopCalls: Array<DesktopCommand> = [];
const layerTest = Publisher.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(DraftStore.layer, SessionPosting.layer, articlesStub)),
  Layer.provideMerge(SettingsStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      TokenCipher.layerTest,
      Events.layer,
      desktopStub(
        desktopCalls,
        (command) =>
          Effect.succeed(
            command.type === "sessionPost"
              ? { type: "sessionPost", postId: `s${desktopCalls.length}` }
              : { type: command.type },
          ) as never,
      ),
      xClientStub({
        createPost: (input) =>
          Effect.sleep("10 millis").pipe(
            Effect.map(() => {
              calls.push(input.text);
              return { postId: String(calls.length), costUsd: 0.015 };
            }),
          ),
      }),
    ),
  ),
);

describe("Publisher", () => {
  it.live("posts a draft once however many publishers race for it", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({ blocks: [{ text: "one" }, { text: "two" }] });
      // Post now and the scheduler, at the same instant.
      const results = yield* Effect.all(
        [
          Effect.result(publisher.post(d.id, { purpose: "compose.postNow", retry: false })),
          Effect.result(publisher.post(d.id, { purpose: "plan.scheduler", retry: true })),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
      expect(calls).toEqual(["one", "two"]);
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

  it.effect("an edit resets attempts and post ids so a retry starts the thread over", () =>
    Effect.gen(function* () {
      const drafts = yield* DraftStore.DraftStore;
      const d = yield* drafts.create({ blocks: [{ text: "one" }] });
      yield* drafts.setOutcome(d.id, { status: "failed", attempts: 2, postIds: ["9"], error: "x" });
      const edited = yield* drafts.update(d.id, { blocks: [{ text: "rewritten" }] });
      expect(edited.attempts).toBe(0);
      expect(edited.postIds).toEqual([]);
      expect(edited.error).toBeNull();
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("refuses a poll with a blank option before anything goes to X", () =>
    Effect.gen(function* () {
      calls.length = 0;
      const drafts = yield* DraftStore.DraftStore;
      const publisher = yield* Publisher.Publisher;
      const d = yield* drafts.create({
        blocks: [{ text: "vote" }],
        poll: { options: ["yes", " "], durationMinutes: 60 },
      });
      const out = yield* publisher.post(d.id, { purpose: "compose.postNow", retry: false });
      expect(out.status).toBe("failed");
      expect(out.error).toContain("blank option");
      expect(calls).toHaveLength(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.live("blocks with media go through the x.com session, only when the setting is on", () =>
    Effect.gen(function* () {
      calls.length = 0;
      desktopCalls.length = 0;
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

      const off = yield* publisher.post(d.id, { purpose: "compose.postNow", retry: false });
      expect(off.status).toBe("failed");
      expect(off.error).toContain("enable Session posting");
      expect(desktopCalls).toHaveLength(0);
      expect(calls).toHaveLength(0);

      yield* settings.update({ sessionPostingEnabled: true });
      const on = yield* publisher.post(d.id, { purpose: "compose.postNow", retry: false });
      expect(on.status).toBe("posted");
      // The quote link rides on the first post; the second is a plain API reply to the session post.
      expect(desktopCalls).toEqual([
        {
          type: "sessionPost",
          text: "look\nhttps://x.com/levelsio/status/7",
          mediaPaths: ["/m/a.png"],
        },
      ]);
      expect(calls).toEqual(["plain"]);
      expect(on.postIds).toEqual(["s1", "1"]);
    }).pipe(Effect.provide(layerTest)),
  );
});

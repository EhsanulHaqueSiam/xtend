import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as Events from "../events/Events.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as DraftStore from "./DraftStore.ts";
import * as Media from "./Media.ts";

const tmp = `/tmp/xtend-media-test-${process.pid}`;
const layerTest = Media.layer.pipe(
  Layer.provideMerge(DraftStore.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      Sqlite.layerMemory,
      Events.layer,
      ServerConfig.layer({
        version: "test",
        port: 0,
        host: "127.0.0.1",
        baseDir: tmp,
        dbPath: ":memory:",
        staticDir: undefined,
        devUrl: undefined,
        supervisor: "none",
      }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const png = (draftId: string, blockIndex = 0) =>
  ({ draftId, blockIndex, kind: "image", ext: "PNG", bytes: new Uint8Array([1, 2, 3]) }) as const;

describe("Media", () => {
  it.effect("stores files beside the draft and holds a post to X's media rule", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const drafts = yield* DraftStore.DraftStore;
      const media = yield* Media.Media;
      const d = yield* drafts.create({ blocks: [{ text: "a" }, { text: "b" }] });
      const one = yield* media.add(png(d.id));
      const file = one.media[0]!.path;
      expect(file.startsWith(`${tmp}/media/${d.id}/`) && file.endsWith(".png")).toBe(true);
      expect([...(yield* fs.readFile(file))]).toEqual([1, 2, 3]);

      for (let i = 0; i < 3; i++) yield* media.add(png(d.id));
      expect((yield* Effect.flip(media.add(png(d.id)))).detail).toContain("at most 4 images");
      const video = { ...png(d.id), kind: "video", ext: "mp4" } as const;
      expect((yield* Effect.flip(media.add(video))).detail).toContain("cannot share");
      yield* media.add({ ...video, blockIndex: 1 });
      expect((yield* Effect.flip(media.add(png(d.id, 1)))).detail).toContain("already has a video");

      const big = { ...png(d.id, 1), bytes: new Uint8Array(15 * 1024 * 1024 + 1) };
      expect((yield* Effect.flip(media.add(big))).detail).toContain("the limit is 15 MB");

      const left = yield* media.remove(d.id, one.media[0]!.id);
      expect(left.media).toHaveLength(4);
      expect(yield* fs.exists(file)).toBe(false);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("an edit that takes posts away takes their files with them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const drafts = yield* DraftStore.DraftStore;
      const media = yield* Media.Media;
      const d = yield* drafts.create({ blocks: [{ text: "a" }, { text: "b" }, { text: "c" }] });
      const first = (yield* media.add(png(d.id, 0))).media[0]!;
      const last = (yield* media.add(png(d.id, 2))).media[1]!;

      // "Use" on a one-post idea: the editor still sends the third post's file in its patch.
      const used = yield* media.update(d.id, {
        blocks: [{ text: "one idea" }],
        media: [first, last].map(({ id, blockIndex, alt, position }) => ({
          id,
          blockIndex,
          alt,
          position,
        })),
      });
      expect(used.media.map((m) => m.id)).toEqual([first.id]);
      expect(yield* fs.exists(last.path)).toBe(false);
      expect(yield* fs.exists(first.path)).toBe(true);
      // Nor can a file be added to a post the draft does not have.
      expect((yield* Effect.flip(media.add(png(d.id, 1)))).detail).toBe("This draft has no post 2");

      // An article's cover belongs to no post, so it stays whatever the blocks say.
      const article = yield* media.update(d.id, { kind: "article", blocks: [] });
      expect(article.media.map((m) => m.id)).toEqual([first.id]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("a draft being posted or posted keeps its files as they went out", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const drafts = yield* DraftStore.DraftStore;
      const media = yield* Media.Media;
      const d = yield* drafts.create({ blocks: [{ text: "a" }] });
      const id = (yield* media.add(png(d.id))).media[0]!.id;
      expect(yield* drafts.claim(d.id)).toBe(true);
      for (const attempt of [media.add(png(d.id)), media.remove(d.id, id), media.removeDraft(d.id)])
        expect((yield* Effect.flip(attempt)).detail).toContain("posting");
      expect(yield* fs.exists(`${tmp}/media/${d.id}`)).toBe(true);

      yield* drafts.setOutcome(d.id, { status: "posted" });
      expect((yield* Effect.flip(media.add(png(d.id)))).detail).toContain("posted");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("deleting a draft deletes its files and nothing outside them", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const drafts = yield* DraftStore.DraftStore;
      const media = yield* Media.Media;
      const d = yield* drafts.create({ blocks: [{ text: "a" }] });
      yield* media.add(png(d.id));
      const other = yield* drafts.create({ blocks: [{ text: "b" }] });
      yield* media.add(png(other.id));

      yield* media.removeDraft(d.id);
      expect(yield* fs.exists(`${tmp}/media/${d.id}`)).toBe(false);
      expect((yield* Effect.flip(drafts.get(d.id))).detail).toContain("No draft");
      // An id from the wire that is a path, not a draft, must not reach a recursive delete.
      yield* media.removeDraft("..");
      expect(yield* fs.exists(`${tmp}/media/${other.id}`)).toBe(true);
    }).pipe(Effect.provide(layerTest)),
  );
});

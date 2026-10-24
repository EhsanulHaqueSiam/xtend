import {
  ComposeError,
  type Draft,
  type DraftPatch,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_IMAGES,
  type MediaKind,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as DraftStore from "./DraftStore.ts";

export interface MediaAddInput {
  readonly draftId: string;
  readonly blockIndex: number;
  readonly kind: MediaKind;
  /** File extension without the dot, e.g. "png". */
  readonly ext: string;
  readonly bytes: Uint8Array;
  readonly alt?: string;
}

/** Attachments: the file under `<baseDir>/media/<draftId>/` plus its row in the draft. */
export class Media extends Context.Service<
  Media,
  {
    /** Refuses files over MEDIA_MAX_BYTES and blocks that already hold 4 images or a video. */
    readonly add: (input: MediaAddInput) => Effect.Effect<Draft, ComposeError>;
    readonly remove: (draftId: string, id: string) => Effect.Effect<Draft, ComposeError>;
    /** DraftStore.update, then deletes the files of attachments the edit dropped with their post. */
    readonly update: (id: string, patch: DraftPatch) => Effect.Effect<Draft, ComposeError>;
    /** Deletes the draft and its files; DraftStore.remove alone would leave them on disk. */
    readonly removeDraft: (draftId: string) => Effect.Effect<void, ComposeError>;
  }
>()("xtend/compose/Media") {}

/** Why the block cannot take the file, or null. The X rule: one video alone, or up to four images. */
export const roomFor = (draft: Draft, blockIndex: number, kind: MediaKind): string | null => {
  // What a publisher has claimed or posted is final; a file removed now could vanish mid-upload.
  if (draft.status === "posting" || draft.status === "posted")
    return `Draft is ${draft.status}; start a new draft to change it`;
  if (draft.kind === "thread" && blockIndex >= draft.blocks.length)
    return `This draft has no post ${blockIndex + 1}`;
  const existing = draft.media;
  const here = existing.filter((m) => m.blockIndex === blockIndex);
  if (here.some((m) => m.kind === "video")) return "This post already has a video";
  if (kind === "video" && here.length > 0) return "A video cannot share a post with images";
  if (here.length >= MEDIA_MAX_IMAGES) return `A post holds at most ${MEDIA_MAX_IMAGES} images`;
  return null;
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { baseDir } = yield* ServerConfig.ServerConfig;
  const drafts = yield* DraftStore.DraftStore;
  const fail = (operation: string) => (cause: unknown) =>
    cause instanceof ComposeError
      ? cause
      : new ComposeError({ operation, detail: String(cause).slice(0, 300) });

  const add = Effect.fn("Media.add")(
    function* (input: MediaAddInput) {
      if (input.bytes.byteLength > MEDIA_MAX_BYTES)
        return yield* new ComposeError({
          operation: "mediaAdd",
          detail: `File is ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is ${MEDIA_MAX_BYTES / 1024 / 1024} MB`,
        });
      const draft = yield* drafts.get(input.draftId);
      const blocked = roomFor(draft, input.blockIndex, input.kind);
      if (blocked !== null)
        return yield* new ComposeError({ operation: "mediaAdd", detail: blocked });
      const id = crypto.randomUUID();
      const ext = input.ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const dir = path.join(baseDir, "media", draft.id);
      yield* fs.makeDirectory(dir, { recursive: true });
      const file = path.join(dir, `${id}.${ext}`);
      yield* fs.writeFile(file, input.bytes);
      return yield* drafts.mediaInsert(draft.id, {
        id,
        blockIndex: input.blockIndex,
        path: file,
        kind: input.kind,
        alt: input.alt ?? "",
      });
    },
    Effect.mapError(fail("mediaAdd")),
  );

  const remove = Effect.fn("Media.remove")(
    function* (draftId: string, id: string) {
      const { status } = yield* drafts.get(draftId);
      if (status === "posting" || status === "posted")
        return yield* new ComposeError({
          operation: "mediaRemove",
          detail: `Draft is ${status}; start a new draft to change it`,
        });
      const file = yield* drafts.mediaRemove(draftId, id);
      // The row is gone either way; a file that is already missing is not an error.
      if (file !== null) yield* fs.remove(file).pipe(Effect.ignore);
      return yield* drafts.get(draftId);
    },
    Effect.mapError(fail("mediaRemove")),
  );

  const update = Effect.fn("Media.update")(
    function* (id: string, patch: DraftPatch) {
      const before = yield* drafts.get(id);
      const after = yield* drafts.update(id, patch);
      // shortcut: a file added between the two reads and dropped by this edit stays on disk until the draft is deleted.
      for (const m of before.media)
        if (!after.media.some((a) => a.id === m.id)) yield* fs.remove(m.path).pipe(Effect.ignore);
      return after;
    },
    Effect.mapError(fail("update")),
  );

  const removeDraft = Effect.fn("Media.removeDraft")(
    function* (draftId: string) {
      yield* drafts.remove(draftId);
      // Only a plain id may name a directory: this one is deleted recursively.
      if (/^[\w-]+$/.test(draftId))
        yield* fs
          .remove(path.join(baseDir, "media", draftId), { recursive: true })
          .pipe(Effect.ignore);
    },
    Effect.mapError(fail("remove")),
  );

  return Media.of({ add, remove, update, removeDraft });
});

export const layer = Layer.effect(Media, make);

import {
  ComposeError,
  type Draft,
  type DraftBlock,
  type DraftMedia,
  type DraftPatch,
  type DraftPoll,
  type DraftStatus,
  type QueueRun,
  ReplySettings,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as Events from "../events/Events.ts";

const BlocksJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ text: Schema.String, replySettings: Schema.optional(ReplySettings) }),
  ),
);
const decodeBlocks = Schema.decodeUnknownSync(BlocksJson);
const encodeBlocks = Schema.encodeSync(BlocksJson);
const PollJson = Schema.fromJsonString(
  Schema.Struct({ options: Schema.Array(Schema.String), durationMinutes: Schema.Int }),
);
const decodePoll = Schema.decodeUnknownSync(PollJson);
const encodePoll = Schema.encodeSync(PollJson);
const IdsJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeIds = Schema.decodeUnknownSync(IdsJson);
const encodeIds = Schema.encodeSync(IdsJson);

interface DraftRow {
  readonly id: string;
  readonly kind: Draft["kind"];
  readonly status: DraftStatus;
  readonly title: string;
  readonly body: string;
  readonly blocks_json: string;
  readonly reply_settings: Draft["replySettings"];
  readonly poll_json: string | null;
  readonly hide_link_previews: number;
  readonly thread_delay_seconds: number;
  readonly source: string | null;
  readonly quote_url: string | null;
  readonly reply_to_post_id: string | null;
  readonly article_id: string | null;
  readonly link_preview_note: string | null;
  readonly scheduled_at: string | null;
  readonly post_ids_json: string;
  readonly error: string | null;
  readonly attempts: number;
  readonly posted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RunRow {
  readonly id: number;
  readonly draft_id: string;
  readonly at: string;
  readonly attempt: number;
  readonly ok: number;
  readonly detail: string;
}

interface MediaRow {
  readonly id: string;
  readonly draft_id: string;
  readonly block_index: number;
  readonly path: string;
  readonly kind: DraftMedia["kind"];
  readonly alt: string;
  readonly position: number;
}

const toMedia = (m: MediaRow): DraftMedia => ({
  id: m.id,
  blockIndex: m.block_index,
  path: m.path,
  kind: m.kind,
  alt: m.alt,
  position: m.position,
});

const toDraft = (r: DraftRow, media: ReadonlyArray<MediaRow>): Draft => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  title: r.title,
  body: r.body,
  blocks: decodeBlocks(r.blocks_json),
  replySettings: r.reply_settings,
  poll: r.poll_json === null ? null : decodePoll(r.poll_json),
  hideLinkPreviews: r.hide_link_previews === 1,
  linkPreviewNote: r.link_preview_note,
  threadDelaySeconds: r.thread_delay_seconds,
  source: r.source,
  quoteUrl: r.quote_url,
  replyToPostId: r.reply_to_post_id,
  articleId: r.article_id,
  media: media.filter((m) => m.draft_id === r.id).map(toMedia),
  scheduledAt: r.scheduled_at,
  postIds: decodeIds(r.post_ids_json),
  error: r.error,
  attempts: r.attempts,
  postedAt: r.posted_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRun = (r: RunRow): QueueRun => ({
  id: r.id,
  draftId: r.draft_id,
  at: r.at,
  attempt: r.attempt,
  ok: r.ok === 1,
  detail: r.detail,
});

/** Fields only the service sets: scheduling and the posting outcome. */
export interface DraftOutcome {
  readonly status?: DraftStatus;
  readonly scheduledAt?: string | null;
  readonly postIds?: ReadonlyArray<string>;
  readonly error?: string | null;
  readonly attempts?: number;
  readonly postedAt?: string | null;
  readonly articleId?: string | null;
  readonly linkPreviewNote?: string | null;
}

export class DraftStore extends Context.Service<
  DraftStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    readonly get: (id: string) => Effect.Effect<Draft, ComposeError>;
    readonly create: (patch: DraftPatch) => Effect.Effect<Draft, ComposeError>;
    readonly update: (id: string, patch: DraftPatch) => Effect.Effect<Draft, ComposeError>;
    readonly setOutcome: (id: string, outcome: DraftOutcome) => Effect.Effect<Draft, ComposeError>;
    /**
     * Moves the draft to `posting` in one statement, so of two publishers racing for it
     * exactly one gets true. Posted and already-posting drafts cannot be claimed.
     */
    readonly claim: (id: string) => Effect.Effect<boolean, ComposeError>;
    /** Drafts left in `posting` by a crash become failed on restart; X may have part of the thread. */
    readonly failInterrupted: Effect.Effect<void, ComposeError>;
    readonly remove: (id: string) => Effect.Effect<void, ComposeError>;
    /** Queued drafts whose scheduled time is at or before `now`, oldest first. */
    readonly due: (now: string) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    readonly byStatus: (status: DraftStatus) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    /** Queued and posted drafts whose scheduled or posted time falls in [from, to). */
    readonly inRange: (
      from: string,
      to: string,
    ) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    readonly logRun: (run: Omit<QueueRun, "id" | "at">) => Effect.Effect<void, ComposeError>;
    readonly runs: (draftId: string) => Effect.Effect<ReadonlyArray<QueueRun>, ComposeError>;
    /** Records a stored file as the last attachment of its block. The file itself is Media's job. */
    readonly mediaInsert: (
      draftId: string,
      media: Omit<DraftMedia, "position">,
    ) => Effect.Effect<Draft, ComposeError>;
    /** Removes the row and returns the file path to delete, or null when there was no such row. */
    readonly mediaRemove: (
      draftId: string,
      id: string,
    ) => Effect.Effect<string | null, ComposeError>;
  }
>()("xtend/compose/DraftStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const events = yield* Events.Events;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const fail = (operation: string) => (cause: unknown) =>
    new ComposeError({ operation, detail: String(cause).slice(0, 300) });

  const rowById = Effect.fn("DraftStore.rowById")(function* (id: string) {
    const rows = yield* sql<DraftRow>`SELECT * FROM drafts WHERE id = ${id}`;
    const row = rows[0];
    if (row === undefined)
      return yield* new ComposeError({ operation: "get", detail: `No draft ${id}` });
    return row;
  });

  const mediaOf = (draftId: string) =>
    sql<MediaRow>`SELECT * FROM draft_media WHERE draft_id = ${draftId} ORDER BY block_index, position`;

  const draftById = Effect.fn("DraftStore.draftById")(function* (id: string) {
    return toDraft(yield* rowById(id), yield* mediaOf(id));
  });

  const get = Effect.fn("DraftStore.get")(
    function* (id: string) {
      return yield* draftById(id);
    },
    Effect.mapError(fail("get")),
  );

  // One media query for the whole page rather than one per draft.
  const withMedia = (rows: ReadonlyArray<DraftRow>) =>
    rows.length === 0
      ? Effect.succeed([])
      : Effect.map(
          sql<MediaRow>`SELECT * FROM draft_media WHERE draft_id IN ${sql.in(rows.map((r) => r.id))} ORDER BY block_index, position`,
          (media) => rows.map((r) => toDraft(r, media)),
        );

  const statusChanged = (id: string, before: DraftStatus, after: DraftStatus) =>
    before === after
      ? Effect.void
      : events.publish({ type: "draft_status_changed", payload: { draftId: id, status: after } });

  const list = sql<DraftRow>`SELECT * FROM drafts ORDER BY updated_at DESC LIMIT 200`.pipe(
    Effect.flatMap(withMedia),
    Effect.mapError(fail("list")),
  );

  const create = Effect.fn("DraftStore.create")(
    function* (patch: DraftPatch) {
      const id = crypto.randomUUID();
      const at = yield* now;
      yield* sql`INSERT INTO drafts (id, created_at, updated_at) VALUES (${id}, ${at}, ${at})`;
      return yield* update(id, patch);
    },
    Effect.mapError(fail("create")),
  );

  const update = Effect.fn("DraftStore.update")(
    function* (id: string, patch: DraftPatch) {
      const r = yield* rowById(id);
      if (r.status === "posted" || r.status === "posting")
        return yield* new ComposeError({
          operation: "update",
          detail: `Draft is ${r.status}; start a new draft to change it`,
        });
      const at = yield* now;
      // New content means a new thread: a retry must not resume at the old post ids.
      const edited =
        patch.blocks !== undefined ||
        patch.body !== undefined ||
        patch.title !== undefined ||
        patch.poll !== undefined ||
        patch.quoteUrl !== undefined ||
        patch.replyToPostId !== undefined ||
        patch.media !== undefined;
      const blocks: ReadonlyArray<DraftBlock> = patch.blocks ?? decodeBlocks(r.blocks_json);
      const poll: DraftPoll | null =
        patch.poll === undefined
          ? r.poll_json === null
            ? null
            : decodePoll(r.poll_json)
          : patch.poll;
      yield* sql`
        UPDATE drafts SET
          kind = ${patch.kind ?? r.kind},
          status = ${patch.status ?? r.status},
          title = ${patch.title ?? r.title},
          body = ${patch.body ?? r.body},
          blocks_json = ${encodeBlocks(blocks)},
          reply_settings = ${patch.replySettings ?? r.reply_settings},
          poll_json = ${poll === null ? null : encodePoll(poll)},
          hide_link_previews = ${(patch.hideLinkPreviews ?? r.hide_link_previews === 1) ? 1 : 0},
          thread_delay_seconds = ${patch.threadDelaySeconds ?? r.thread_delay_seconds},
          source = ${patch.source === undefined ? r.source : patch.source},
          quote_url = ${patch.quoteUrl === undefined ? r.quote_url : patch.quoteUrl},
          reply_to_post_id = ${patch.replyToPostId === undefined ? r.reply_to_post_id : patch.replyToPostId},
          attempts = ${edited ? 0 : r.attempts},
          post_ids_json = ${edited ? "[]" : r.post_ids_json},
          article_id = ${edited ? null : r.article_id},
          error = ${edited ? null : r.error},
          updated_at = ${at}
        WHERE id = ${id}
      `;
      for (const m of patch.media ?? [])
        yield* sql`
          UPDATE draft_media SET block_index = ${m.blockIndex}, alt = ${m.alt}, position = ${m.position}
          WHERE id = ${m.id} AND draft_id = ${id}
        `;
      const next = yield* draftById(id);
      yield* statusChanged(id, r.status, next.status);
      return next;
    },
    Effect.mapError(fail("update")),
  );

  const claim = Effect.fn("DraftStore.claim")(
    function* (id: string) {
      const at = yield* now;
      const rows = yield* sql<{ id: string }>`
        UPDATE drafts SET status = 'posting', updated_at = ${at}
        WHERE id = ${id} AND status IN ('draft', 'queued', 'failed', 'suggested')
        RETURNING id
      `;
      if (rows.length === 1) yield* statusChanged(id, "queued", "posting");
      return rows.length === 1;
    },
    Effect.mapError(fail("claim")),
  );

  const failInterrupted = Effect.gen(function* () {
    const at = yield* now;
    yield* sql`
      UPDATE drafts SET status = 'failed', error = 'interrupted by a service restart', updated_at = ${at}
      WHERE status = 'posting'
    `;
  }).pipe(Effect.mapError(fail("failInterrupted")));

  const setOutcome = Effect.fn("DraftStore.setOutcome")(
    function* (id: string, o: DraftOutcome) {
      const r = yield* rowById(id);
      const at = yield* now;
      yield* sql`
        UPDATE drafts SET
          status = ${o.status ?? r.status},
          scheduled_at = ${o.scheduledAt === undefined ? r.scheduled_at : o.scheduledAt},
          post_ids_json = ${o.postIds === undefined ? r.post_ids_json : encodeIds(o.postIds)},
          error = ${o.error === undefined ? r.error : o.error},
          attempts = ${o.attempts ?? r.attempts},
          posted_at = ${o.postedAt === undefined ? r.posted_at : o.postedAt},
          article_id = ${o.articleId === undefined ? r.article_id : o.articleId},
          link_preview_note = ${o.linkPreviewNote === undefined ? r.link_preview_note : o.linkPreviewNote},
          updated_at = ${at}
        WHERE id = ${id}
      `;
      const next = yield* draftById(id);
      yield* statusChanged(id, r.status, next.status);
      return next;
    },
    Effect.mapError(fail("setOutcome")),
  );

  const remove = Effect.fn("DraftStore.remove")(
    function* (id: string) {
      yield* sql`DELETE FROM drafts WHERE id = ${id}`;
      yield* sql`DELETE FROM draft_media WHERE draft_id = ${id}`;
    },
    Effect.mapError(fail("remove")),
  );

  const due = Effect.fn("DraftStore.due")(
    function* (at: string) {
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts WHERE status = 'queued' AND scheduled_at <= ${at} ORDER BY scheduled_at ASC
      `;
      return yield* withMedia(rows);
    },
    Effect.mapError(fail("due")),
  );

  const byStatus = Effect.fn("DraftStore.byStatus")(
    function* (status: DraftStatus) {
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts WHERE status = ${status} ORDER BY scheduled_at ASC, updated_at DESC LIMIT 200
      `;
      return yield* withMedia(rows);
    },
    Effect.mapError(fail("byStatus")),
  );

  const inRange = Effect.fn("DraftStore.inRange")(
    function* (from: string, to: string) {
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts
        WHERE (status = 'queued' AND scheduled_at >= ${from} AND scheduled_at < ${to})
           OR (status = 'posted' AND posted_at >= ${from} AND posted_at < ${to})
        ORDER BY COALESCE(posted_at, scheduled_at) ASC LIMIT 200
      `;
      return yield* withMedia(rows);
    },
    Effect.mapError(fail("inRange")),
  );

  const logRun = Effect.fn("DraftStore.logRun")(
    function* (run: Omit<QueueRun, "id" | "at">) {
      const at = yield* now;
      yield* sql`
        INSERT INTO queue_runs (draft_id, at, attempt, ok, detail)
        VALUES (${run.draftId}, ${at}, ${run.attempt}, ${run.ok ? 1 : 0}, ${run.detail})
      `;
    },
    Effect.mapError(fail("logRun")),
  );

  const runs = Effect.fn("DraftStore.runs")(
    function* (draftId: string) {
      const rows = yield* sql<RunRow>`
        SELECT * FROM queue_runs WHERE draft_id = ${draftId} ORDER BY id DESC LIMIT 20
      `;
      return rows.map(toRun);
    },
    Effect.mapError(fail("runs")),
  );

  const mediaInsert = Effect.fn("DraftStore.mediaInsert")(
    function* (draftId: string, m: Omit<DraftMedia, "position">) {
      const [count] = yield* sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM draft_media WHERE draft_id = ${draftId} AND block_index = ${m.blockIndex}
      `;
      yield* sql`
        INSERT INTO draft_media (id, draft_id, block_index, path, kind, alt, position)
        VALUES (${m.id}, ${draftId}, ${m.blockIndex}, ${m.path}, ${m.kind}, ${m.alt}, ${count?.n ?? 0})
      `;
      return yield* draftById(draftId);
    },
    Effect.mapError(fail("mediaAdd")),
  );

  const mediaRemove = Effect.fn("DraftStore.mediaRemove")(
    function* (draftId: string, id: string) {
      const rows = yield* sql<{ path: string }>`
        DELETE FROM draft_media WHERE id = ${id} AND draft_id = ${draftId} RETURNING path
      `;
      return rows[0]?.path ?? null;
    },
    Effect.mapError(fail("mediaRemove")),
  );

  return DraftStore.of({
    list,
    get,
    create,
    update,
    setOutcome,
    claim,
    failInterrupted,
    remove,
    due,
    byStatus,
    inRange,
    logRun,
    runs,
    mediaInsert,
    mediaRemove,
  });
});

/** Events comes from the foundation layer; this layer only depends on it. */
export const layer = Layer.effect(DraftStore, make);

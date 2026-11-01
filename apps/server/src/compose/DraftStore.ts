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
  isComposeError,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { CURRENT_ACCOUNT } from "../persistence/account.ts";
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

type Content = Pick<
  Draft,
  "kind" | "title" | "body" | "blocks" | "poll" | "quoteUrl" | "replyToPostId" | "media"
>;

/** What the first `posts` posts of a thread say (the whole text of an article), as one comparable string. */
const said = (d: Content, posts: number) =>
  JSON.stringify(
    d.kind === "article"
      ? [d.kind, d.title, d.body]
      : [
          d.kind,
          d.poll,
          d.quoteUrl,
          d.replyToPostId,
          d.blocks.slice(0, posts).map((b) => b.text),
          d.media.filter((m) => m.blockIndex < posts).map((m) => [m.id, m.blockIndex, m.position]),
        ],
  );

/** Why a publish cut short is not retried on its own: the post it was sending may have gone out. */
export const IN_FLIGHT =
  "the post it was sending may already be on X, check your profile before retrying";

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
    /** A thread loses the attachments of posts the edit removed; Media.update deletes their files. */
    readonly update: (id: string, patch: DraftPatch) => Effect.Effect<Draft, ComposeError>;
    readonly setOutcome: (id: string, outcome: DraftOutcome) => Effect.Effect<Draft, ComposeError>;
    /**
     * Moves the draft to `posting` in one statement, so of two publishers racing for it
     * exactly one gets true. Posted and already-posting drafts cannot be claimed, nor another
     * account's. With `due`, only a draft still queued for at or before it: the scheduler's list
     * goes stale while it posts, and a draft unscheduled or moved meanwhile must stay put.
     */
    readonly claim: (id: string, due?: string) => Effect.Effect<boolean, ComposeError>;
    /** Drafts left in `posting` by a crash become failed on restart; X may have part of the thread. */
    readonly failInterrupted: Effect.Effect<void, ComposeError>;
    /**
     * Queues the draft for `at` (any ISO 8601 instant, stored as UTC) with a fresh set of retries,
     * or back to a plain draft with null. Refuses posting and posted drafts in the same statement,
     * so it cannot race a publisher.
     */
    readonly reschedule: (id: string, at: string | null) => Effect.Effect<Draft, ComposeError>;
    /** Refuses a draft mid-publish: deleting it would strand the half-posted thread. */
    readonly remove: (id: string) => Effect.Effect<void, ComposeError>;
    /** The current account's queued drafts whose scheduled time is at or before `now`, oldest first. */
    readonly due: (now: string) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    readonly byStatus: (status: DraftStatus) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    /** Scheduled drafts (queued, posting, failed) and posted ones whose time falls in [from, to). */
    readonly inRange: (
      from: string,
      to: string,
    ) => Effect.Effect<ReadonlyArray<Draft>, ComposeError>;
    readonly logRun: (run: Omit<QueueRun, "id" | "at">) => Effect.Effect<void, ComposeError>;
    readonly runs: (draftId: string) => Effect.Effect<ReadonlyArray<QueueRun>, ComposeError>;
    /**
     * Records a stored file as the last attachment of its block. The file itself is Media's job.
     * On a post of the thread already on X, the thread starts over (as with mediaRemove).
     */
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
  const uuids = yield* Crypto.Crypto;
  const events = yield* Events.Events;
  const now = Effect.map(DateTime.now, DateTime.formatIso);
  const fail = (operation: string) => (cause: unknown) =>
    isComposeError(cause)
      ? cause
      : new ComposeError({ operation, detail: String(cause).slice(0, 300) });
  const locked = (operation: string, status: DraftStatus) =>
    new ComposeError({
      operation,
      detail: `Draft is ${status}; start a new draft to change it`,
    });
  // Times are compared as strings in SQL, so every stored one is the same UTC ISO form.
  const instant = (operation: string, text: string) =>
    Option.match(DateTime.make(text), {
      onNone: () => Effect.fail(new ComposeError({ operation, detail: `Not a time: ${text}` })),
      onSome: (t) => Effect.succeed(DateTime.formatIso(t)),
    });

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

  // Unposted first: a long posting history must not push a draft or a queued post off the list.
  const list =
    sql<DraftRow>`SELECT * FROM drafts WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY status = 'posted', updated_at DESC LIMIT 200`.pipe(
      Effect.flatMap(withMedia),
      Effect.mapError(fail("list")),
    );

  const create = Effect.fn("DraftStore.create")(
    function* (patch: DraftPatch) {
      const id = yield* uuids.randomUUIDv4();
      const at = yield* now;
      yield* sql`INSERT INTO drafts (id, created_at, updated_at) VALUES (${id}, ${at}, ${at})`;
      return yield* update(id, patch);
    },
    Effect.mapError(fail("create")),
  );

  const update = Effect.fn("DraftStore.update")(
    function* (id: string, patch: DraftPatch) {
      // One transaction, so a publisher cannot claim the draft between the check and the write.
      const [before, next] = yield* sql.withTransaction(
        Effect.gen(function* () {
          const r = yield* rowById(id);
          if (r.status === "posted" || r.status === "posting")
            return yield* locked("update", r.status);
          const before = toDraft(r, yield* mediaOf(id));
          const blocks: ReadonlyArray<DraftBlock> = patch.blocks ?? before.blocks;
          const poll: DraftPoll | null = patch.poll === undefined ? before.poll : patch.poll;
          const kind = patch.kind ?? before.kind;
          // A thread sends block i's files with post i, so files of a post the edit took away
          // would be dropped unseen when it posts. An article's cover is not tied to a block.
          const kept = (m: DraftMedia) => kind === "article" || m.blockIndex < blocks.length;
          const after: Content = {
            kind,
            title: patch.title ?? before.title,
            body: patch.body ?? before.body,
            blocks,
            poll,
            quoteUrl: patch.quoteUrl === undefined ? before.quoteUrl : patch.quoteUrl,
            replyToPostId:
              patch.replyToPostId === undefined ? before.replyToPostId : patch.replyToPostId,
            media: before.media
              .map((m) => ({ ...m, ...patch.media?.find((p) => p.id === m.id) }))
              .filter(kept),
          };
          // The editor sends every field on each autosave, so only a changed value counts as an edit.
          const edited = said(before, Infinity) !== said(after, Infinity);
          // A retry resumes after the posts already on X; it may keep them only while they still
          // say what went out. Fixing the block that failed must not repost the ones before it.
          const restart =
            said(before, before.postIds.length) !== said(after, before.postIds.length);
          yield* sql`
            UPDATE drafts SET
              kind = ${after.kind},
              status = ${patch.status ?? r.status},
              title = ${after.title},
              body = ${after.body},
              blocks_json = ${encodeBlocks(blocks)},
              reply_settings = ${patch.replySettings ?? r.reply_settings},
              poll_json = ${poll === null ? null : encodePoll(poll)},
              hide_link_previews = ${(patch.hideLinkPreviews ?? r.hide_link_previews === 1) ? 1 : 0},
              thread_delay_seconds = ${patch.threadDelaySeconds ?? r.thread_delay_seconds},
              source = ${patch.source === undefined ? r.source : patch.source},
              quote_url = ${after.quoteUrl},
              reply_to_post_id = ${after.replyToPostId},
              attempts = ${edited ? 0 : r.attempts},
              post_ids_json = ${restart ? "[]" : r.post_ids_json},
              article_id = ${restart ? null : r.article_id},
              error = ${edited ? null : r.error},
              updated_at = ${yield* now}
            WHERE id = ${id}
          `;
          for (const m of patch.media ?? [])
            yield* sql`
              UPDATE draft_media SET block_index = ${m.blockIndex}, alt = ${m.alt}, position = ${m.position}
              WHERE id = ${m.id} AND draft_id = ${id}
            `;
          if (kind === "thread")
            yield* sql`DELETE FROM draft_media WHERE draft_id = ${id} AND block_index >= ${blocks.length}`;
          return [before, yield* draftById(id)] as const;
        }),
      );
      yield* statusChanged(id, before.status, next.status);
      return next;
    },
    Effect.mapError(fail("update")),
  );

  const claim = Effect.fn("DraftStore.claim")(
    function* (id: string, due?: string) {
      const at = yield* now;
      const rows = yield* sql<{ id: string }>`
        UPDATE drafts SET status = 'posting', updated_at = ${at}
        WHERE id = ${id} AND account_id = ${sql.literal(CURRENT_ACCOUNT)} AND ${
          due === undefined
            ? sql`status IN ('draft', 'queued', 'failed', 'suggested')`
            : sql`status = 'queued' AND scheduled_at <= ${due}`
        }
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
      UPDATE drafts SET status = 'failed', error = ${`interrupted by a service restart; ${IN_FLIGHT}`}, updated_at = ${at}
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

  const reschedule = Effect.fn("DraftStore.reschedule")(
    function* (id: string, at: string | null) {
      const r = yield* rowById(id);
      const scheduledAt = at === null ? null : yield* instant("schedule", at);
      const rows = yield* sql<{ id: string }>`
        UPDATE drafts SET
          status = ${scheduledAt === null ? "draft" : "queued"},
          scheduled_at = ${scheduledAt},
          error = ${scheduledAt === null ? r.error : null},
          attempts = ${scheduledAt === null ? r.attempts : 0},
          updated_at = ${yield* now}
        WHERE id = ${id} AND status NOT IN ('posting', 'posted')
        RETURNING id
      `;
      if (rows.length === 0) return yield* locked("schedule", (yield* rowById(id)).status);
      const next = yield* draftById(id);
      yield* statusChanged(id, r.status, next.status);
      return next;
    },
    Effect.mapError(fail("schedule")),
  );

  const remove = Effect.fn("DraftStore.remove")(
    function* (id: string) {
      const gone = yield* sql<{ id: string }>`
        DELETE FROM drafts WHERE id = ${id} AND status <> 'posting' RETURNING id
      `;
      if (gone.length === 1) yield* sql`DELETE FROM draft_media WHERE draft_id = ${id}`;
      else if ((yield* sql`SELECT 1 FROM drafts WHERE id = ${id}`).length > 0)
        return yield* locked("remove", "posting");
    },
    Effect.mapError(fail("remove")),
  );

  const due = Effect.fn("DraftStore.due")(
    function* (at: string) {
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts
        WHERE status = 'queued' AND scheduled_at <= ${at} AND account_id = ${sql.literal(CURRENT_ACCOUNT)}
        ORDER BY scheduled_at ASC
      `;
      return yield* withMedia(rows);
    },
    Effect.mapError(fail("due")),
  );

  const byStatus = Effect.fn("DraftStore.byStatus")(
    function* (status: DraftStatus) {
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts WHERE status = ${status} AND account_id = ${sql.literal(CURRENT_ACCOUNT)} ORDER BY scheduled_at ASC, updated_at DESC LIMIT 200
      `;
      return yield* withMedia(rows);
    },
    Effect.mapError(fail("byStatus")),
  );

  const inRange = Effect.fn("DraftStore.inRange")(
    function* (fromText: string, toText: string) {
      const from = yield* instant("calendar", fromText);
      const to = yield* instant("calendar", toText);
      // A draft mid-publish or one that gave up keeps its slot on the calendar instead of vanishing.
      const rows = yield* sql<DraftRow>`
        SELECT * FROM drafts
        WHERE account_id = ${sql.literal(CURRENT_ACCOUNT)} AND (
          (status IN ('queued', 'posting', 'failed') AND scheduled_at >= ${from} AND scheduled_at < ${to})
          OR (status = 'posted' AND posted_at >= ${from} AND posted_at < ${to}))
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

  // A file added to or taken from a post already on X changes what it says, so the thread starts
  // over as an edit would. An article's cover is not part of what it published.
  const restartAt = (draftId: string, blockIndex: number) => sql`
    UPDATE drafts SET post_ids_json = '[]'
    WHERE id = ${draftId} AND kind = 'thread' AND json_array_length(post_ids_json) > ${blockIndex}
  `;

  const mediaInsert = Effect.fn("DraftStore.mediaInsert")(
    function* (draftId: string, m: Omit<DraftMedia, "position">) {
      // After the last one, not at the count: a removal leaves a gap and the count would tie with it.
      const [last] = yield* sql<{ n: number }>`
        SELECT COALESCE(MAX(position) + 1, 0) AS n FROM draft_media WHERE draft_id = ${draftId} AND block_index = ${m.blockIndex}
      `;
      yield* sql`
        INSERT INTO draft_media (id, draft_id, block_index, path, kind, alt, position)
        VALUES (${m.id}, ${draftId}, ${m.blockIndex}, ${m.path}, ${m.kind}, ${m.alt}, ${last?.n ?? 0})
      `;
      yield* restartAt(draftId, m.blockIndex);
      return yield* draftById(draftId);
    },
    Effect.mapError(fail("mediaAdd")),
  );

  const mediaRemove = Effect.fn("DraftStore.mediaRemove")(
    function* (draftId: string, id: string) {
      const [row] = yield* sql<{ path: string; block_index: number }>`
        DELETE FROM draft_media WHERE id = ${id} AND draft_id = ${draftId} RETURNING path, block_index
      `;
      if (row === undefined) return null;
      yield* restartAt(draftId, row.block_index);
      return row.path;
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
    reschedule,
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

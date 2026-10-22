import {
  type ThreadEvent,
  type ThreadEventRecord,
  ThreadEvent as ThreadEventSchema,
  type ThreadId,
  ThreadNotFoundError,
  type ThreadStatus,
  ThreadStoreError,
  type ThreadSummary,
} from "@xtend/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

const EventJson = Schema.fromJsonString(ThreadEventSchema);
const encodeEvent = Schema.encodeEffect(EventJson);
const decodeEvent = Schema.decodeUnknownEffect(EventJson);

interface ThreadRow {
  readonly thread_id: ThreadId;
  readonly title: string;
  readonly status: ThreadStatus;
  readonly claude_session_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface EventRow {
  readonly sequence: number;
  readonly thread_id: ThreadId;
  readonly at: string;
  readonly event_json: string;
}

const summaryFromRow = (row: ThreadRow): ThreadSummary => ({
  threadId: row.thread_id,
  title: row.title,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class ThreadStore extends Context.Service<
  ThreadStore,
  {
    readonly create: (title: string | undefined) => Effect.Effect<ThreadSummary, ThreadStoreError>;
    readonly list: Effect.Effect<ReadonlyArray<ThreadSummary>, ThreadStoreError>;
    readonly get: (
      threadId: ThreadId,
    ) => Effect.Effect<
      ThreadSummary & { readonly claudeSessionId: string | null },
      ThreadStoreError | ThreadNotFoundError
    >;
    readonly setStatus: (
      threadId: ThreadId,
      status: ThreadStatus,
    ) => Effect.Effect<void, ThreadStoreError>;
    readonly setClaudeSession: (
      threadId: ThreadId,
      sessionId: string,
    ) => Effect.Effect<void, ThreadStoreError>;
    readonly append: (
      threadId: ThreadId,
      event: ThreadEvent,
    ) => Effect.Effect<ThreadEventRecord, ThreadStoreError>;
    readonly events: (
      threadId: ThreadId,
      afterSequence: number,
    ) => Effect.Effect<ReadonlyArray<ThreadEventRecord>, ThreadStoreError>;
    /** History after `afterSequence`, then live appends until the subscriber leaves. */
    readonly subscribe: (
      threadId: ThreadId,
      afterSequence: number,
    ) => Stream.Stream<ThreadEventRecord, ThreadStoreError>;
  }
>()("xtend/agent/ThreadStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const appended = yield* PubSub.unbounded<ThreadEventRecord>();

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const recordFromRow = (row: EventRow) =>
    Effect.map(decodeEvent(row.event_json), (event) => ({
      sequence: row.sequence,
      threadId: row.thread_id,
      at: row.at,
      event,
    }));

  const create = Effect.fn("ThreadStore.create")(
    function* (title: string | undefined) {
      const threadId = (yield* crypto.randomUUIDv4()) as ThreadId;
      const at = yield* now;
      const resolvedTitle = title?.trim() || "New thread";
      yield* sql`
        INSERT INTO threads (thread_id, title, status, created_at, updated_at)
        VALUES (${threadId}, ${resolvedTitle}, 'idle', ${at}, ${at})
      `;
      return {
        threadId,
        title: resolvedTitle,
        status: "idle" as const,
        createdAt: at,
        updatedAt: at,
      };
    },
    Effect.mapError((cause) => new ThreadStoreError({ operation: "create", cause })),
  );

  const list = sql<ThreadRow>`SELECT * FROM threads ORDER BY updated_at DESC`.pipe(
    Effect.map((rows) => rows.map(summaryFromRow)),
    Effect.mapError((cause) => new ThreadStoreError({ operation: "list", cause })),
    Effect.withSpan("ThreadStore.list"),
  );

  const get = Effect.fn("ThreadStore.get")(function* (threadId: ThreadId) {
    const rows = yield* sql<ThreadRow>`SELECT * FROM threads WHERE thread_id = ${threadId}`.pipe(
      Effect.mapError((cause) => new ThreadStoreError({ operation: "list", cause })),
    );
    const row = rows[0];
    if (row === undefined) return yield* new ThreadNotFoundError({ threadId });
    return { ...summaryFromRow(row), claudeSessionId: row.claude_session_id };
  });

  const setStatus = Effect.fn("ThreadStore.setStatus")(
    function* (threadId: ThreadId, status: ThreadStatus) {
      const at = yield* now;
      yield* sql`UPDATE threads SET status = ${status}, updated_at = ${at} WHERE thread_id = ${threadId}`;
    },
    Effect.mapError((cause) => new ThreadStoreError({ operation: "session", cause })),
  );

  const setClaudeSession = Effect.fn("ThreadStore.setClaudeSession")(
    function* (threadId: ThreadId, sessionId: string) {
      yield* sql`UPDATE threads SET claude_session_id = ${sessionId} WHERE thread_id = ${threadId}`;
    },
    Effect.mapError((cause) => new ThreadStoreError({ operation: "session", cause })),
  );

  const append = Effect.fn("ThreadStore.append")(
    function* (threadId: ThreadId, event: ThreadEvent) {
      const at = yield* now;
      const json = yield* encodeEvent(event);
      const rows = yield* sql<{ readonly sequence: number }>`
        INSERT INTO thread_events (thread_id, at, event_json)
        VALUES (${threadId}, ${at}, ${json})
        RETURNING sequence
      `;
      yield* sql`UPDATE threads SET updated_at = ${at} WHERE thread_id = ${threadId}`;
      const record: ThreadEventRecord = { sequence: rows[0]?.sequence ?? 0, threadId, at, event };
      yield* PubSub.publish(appended, record);
      return record;
    },
    Effect.mapError((cause) => new ThreadStoreError({ operation: "append", cause })),
  );

  const events = Effect.fn("ThreadStore.events")(
    function* (threadId: ThreadId, afterSequence: number) {
      const rows = yield* sql<EventRow>`
        SELECT * FROM thread_events
        WHERE thread_id = ${threadId} AND sequence > ${afterSequence}
        ORDER BY sequence ASC
      `;
      return yield* Effect.forEach(rows, recordFromRow);
    },
    Effect.mapError((cause) => new ThreadStoreError({ operation: "events", cause })),
  );

  const subscribe = (threadId: ThreadId, afterSequence: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before replaying so nothing appended in between is lost; the
        // sequence filter drops what the replay already delivered.
        const subscription = yield* PubSub.subscribe(appended);
        const history = yield* events(threadId, afterSequence);
        const lastReplayed = history.at(-1)?.sequence ?? afterSequence;
        return Stream.concat(
          Stream.fromIterable(history),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter(
              (record) => record.threadId === threadId && record.sequence > lastReplayed,
            ),
          ),
        );
      }),
    );

  return ThreadStore.of({
    create,
    list,
    get,
    setStatus,
    setClaudeSession,
    append,
    events,
    subscribe,
  });
});

export const layer = Layer.effect(ThreadStore, make);

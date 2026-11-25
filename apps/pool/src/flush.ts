/** A buffered push as stored: the install, when the worker took it, and its `{ items }` body. */
export type Pending = { install: string; at: string; body: string };

/** Roughly what one pool_flush call carries; a single larger push still goes alone. */
export const CHUNK_BYTES = 1_000_000;

/** The id of the last row of the next chunk, from the buffer's head in id order. */
export const chunkEnd = (head: ReadonlyArray<{ id: number; bytes: number }>) => {
  let total = 0;
  let last = head[0]!.id;
  for (const row of head) {
    if (total > 0 && total + row.bytes > CHUNK_BYTES) break;
    total += row.bytes;
    last = row.id;
  }
  return last;
};

/**
 * pool_flush's argument, built as text: bodies were validated JSON when they were queued, so
 * they are spliced in rather than parsed again inside the worker's CPU budget.
 */
export const entriesJson = (rows: ReadonlyArray<Pending>) =>
  `[${rows.map((r) => `{"install":${JSON.stringify(r.install)},"at":${JSON.stringify(r.at)},"body":${r.body}}`).join(",")}]`;

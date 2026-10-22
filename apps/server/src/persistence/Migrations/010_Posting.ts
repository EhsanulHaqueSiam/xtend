import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Phase 2 posting: media per block, quote links, reply targets, X article ids and the
// hide-link-preview outcome. Owned by the compose area.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Files live under <baseDir>/media/<draft_id>/; a row is the attachment, its file is at `path`.
  yield* sql`
    CREATE TABLE draft_media (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      block_index INTEGER NOT NULL DEFAULT 0,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      alt TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )
  `;
  yield* sql`CREATE INDEX idx_draft_media_draft ON draft_media(draft_id, block_index, position)`;

  yield* sql`ALTER TABLE drafts ADD COLUMN quote_url TEXT`;
  yield* sql`ALTER TABLE drafts ADD COLUMN reply_to_post_id TEXT`;
  yield* sql`ALTER TABLE drafts ADD COLUMN article_id TEXT`;
  yield* sql`ALTER TABLE drafts ADD COLUMN link_preview_note TEXT`;
});

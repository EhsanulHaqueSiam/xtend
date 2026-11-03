import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The desktops on this service. A paired one has its own token (stored hashed) so it can be
// signed out alone; prefs is JSON and stays null until the device first reports what it had.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      prefs TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )
  `;
});

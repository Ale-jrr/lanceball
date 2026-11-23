import { DatabaseSync } from 'node:sqlite';
import { auctionEngine } from './supabase/functions/_shared/auction-core.mjs';

export function openAuction(path, now = Date.now, snapshot = null) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS room (
      id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL
    );
  `);

  if (snapshot) db.prepare('INSERT INTO room VALUES (1, ?)').run(JSON.stringify(snapshot));

  // Every mutation loads and saves state inside the same write transaction.
  function mutate(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = db.prepare('SELECT state FROM room WHERE id=1').get();
      const state = row ? JSON.parse(row.state) : null;
      const result = action(state);
      db.prepare('INSERT INTO room VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
        .run(JSON.stringify(result.state));
      db.exec('COMMIT');
      return result.value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return auctionEngine({
    mutate,
    snapshot() {
      const row = db.prepare('SELECT state FROM room WHERE id=1').get();
      return row ? JSON.parse(row.state) : null;
    },
    close() { db.close(); },
  }, now);
}
